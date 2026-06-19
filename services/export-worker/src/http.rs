use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use tokio_util::io::ReaderStream;
use tower_http::cors::{Any, CorsLayer};

use crate::{
    model::{CreateExportRequest, ErrorEnvelope, ExportReadyzResponse},
    service::{ExportDownload, ExportService, ExportServiceError},
    storage::ExportDownloadBody,
};

pub fn build_router(service: ExportService) -> Router {
    Router::new()
        .route("/readyz", get(readyz_handler))
        .route("/api/exports", post(create_export_handler))
        .route("/api/exports/{export_id}", get(get_export_handler))
        .route(
            "/api/exports/{export_id}/download",
            get(download_export_handler),
        )
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(Arc::new(service))
}

async fn readyz_handler(State(service): State<Arc<ExportService>>) -> Json<ExportReadyzResponse> {
    Json(service.readyz().await)
}

async fn create_export_handler(
    State(service): State<Arc<ExportService>>,
    Json(request): Json<CreateExportRequest>,
) -> Response {
    match service.create_export(request).await {
        Ok((manifest, created)) => {
            let status = if created {
                StatusCode::CREATED
            } else {
                StatusCode::OK
            };
            (status, Json(manifest)).into_response()
        }
        Err(error) => error.into_response(),
    }
}

async fn get_export_handler(
    State(service): State<Arc<ExportService>>,
    Path(export_id): Path<String>,
) -> Response {
    match service.get_export(&export_id).await {
        Ok(manifest) => (StatusCode::OK, Json(manifest)).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn download_export_handler(
    State(service): State<Arc<ExportService>>,
    Path(export_id): Path<String>,
) -> Response {
    let manifest = match service.get_export(&export_id).await {
        Ok(manifest) => manifest,
        Err(error) => return error.into_response(),
    };

    if !manifest.is_completed() {
        return response_error(
            StatusCode::CONFLICT,
            "export_not_ready",
            "Export is not ready for download yet.",
            false,
        )
        .into_response();
    }

    match service.download_export(&export_id).await {
        Ok(download) => download_response(download, &export_id),
        Err(error) => error.into_response(),
    }
}

impl IntoResponse for ExportServiceError {
    fn into_response(self) -> Response {
        let status = self.status_code();
        let payload = response_error(status, self.code(), self.message(), self.retryable());
        payload.into_response()
    }
}

fn response_error(
    status: StatusCode,
    code: &str,
    message: &str,
    retryable: bool,
) -> (StatusCode, Json<ErrorEnvelope>) {
    (
        status,
        Json(ErrorEnvelope {
            error: crate::model::ErrorDetails {
                code: code.to_string(),
                message: message.to_string(),
                retryable,
            },
        }),
    )
}

fn download_response(download: ExportDownload, export_id: &str) -> Response {
    let content_type = HeaderValue::from_static("video/mp4");
    let content_disposition = HeaderValue::from_str(&format!(
        "attachment; filename=\"{}\"",
        crate::model::export_download_filename(export_id)
    ))
    .unwrap_or_else(|_| HeaderValue::from_static("attachment"));

    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_DISPOSITION, content_disposition);

    if let Some(length) = download.content_length {
        if let Ok(length_value) = HeaderValue::from_str(&length.to_string()) {
            builder = builder.header(header::CONTENT_LENGTH, length_value);
        }
    }

    let body = match download.body {
        ExportDownloadBody::Bytes(bytes) => Body::from(bytes),
        ExportDownloadBody::Stream(reader) => Body::from_stream(ReaderStream::new(reader)),
    };

    builder.body(body).unwrap_or_else(|_| {
        response_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "response_build_failed",
            "Unable to build the export download response.",
            true,
        )
        .into_response()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::Arc;

    use axum::body::to_bytes;
    use chrono::TimeZone;
    use serde_json::Value;
    use tower::ServiceExt;

    use crate::{
        ffmpeg::FakeFfmpegRunner,
        model::{
            upload_manifest_key, CreateExportRequest, ParticipantRole, UploadChunkManifest,
            UploadChunkStatus, UploadManifest, UploadStatus, TARGET_FORMAT, TARGET_RESOLUTION,
        },
        service::ExportService,
        storage::{ExportStorage, StorageBackend},
    };

    fn build_router_for_tests() -> (Router, Arc<dyn ExportStorage>, String) {
        let storage = StorageBackend::memory().into_shared();
        let ffmpeg = Arc::new(FakeFfmpegRunner::available());
        let router = build_router(ExportService::new(storage.clone(), ffmpeg));
        (router, storage, "recording-1".to_string())
    }

    fn request_payload(
        recording_id: &str,
        upload_id: &str,
        target_resolution: &str,
    ) -> CreateExportRequest {
        CreateExportRequest {
            recording_id: recording_id.to_string(),
            upload_id: upload_id.to_string(),
            session_id: "session-1".to_string(),
            participant_id: "participant-1".to_string(),
            role: ParticipantRole::Host,
            target: crate::model::ExportTargetRequest {
                format: TARGET_FORMAT.to_string(),
                resolution: target_resolution.to_string(),
            },
        }
    }

    fn uploaded_manifest(recording_id: &str, upload_id: &str) -> UploadManifest {
        let now = chrono::Utc
            .with_ymd_and_hms(2026, 6, 19, 10, 0, 0)
            .single()
            .expect("valid timestamp");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let chunk_a_checksum = sha256_hex(&chunk_bytes[0]);
        let chunk_b_checksum = sha256_hex(&chunk_bytes[1]);

        UploadManifest {
            manifest_version: 1,
            recording_id: recording_id.to_string(),
            session_id: "session-1".to_string(),
            participant_id: "participant-1".to_string(),
            role: ParticipantRole::Host,
            upload_id: upload_id.to_string(),
            status: UploadStatus::Uploaded,
            mime_type: Some("video/webm".to_string()),
            expected_chunk_count: 2,
            chunk_size_bytes: chunk_bytes.first().expect("chunk").len() as u64,
            total_bytes: chunk_bytes.iter().map(|bytes| bytes.len() as u64).sum(),
            uploaded_bytes: chunk_bytes.iter().map(|bytes| bytes.len() as u64).sum(),
            uploaded_chunk_count: 2,
            created_at: now,
            updated_at: now,
            completed_at: Some(now),
            last_error: None,
            chunks: vec![
                UploadChunkManifest {
                    chunk_index: 0,
                    expected_bytes: chunk_bytes[0].len() as u64,
                    uploaded_bytes: chunk_bytes[0].len() as u64,
                    status: UploadChunkStatus::Uploaded,
                    checksum: Some(chunk_a_checksum),
                    updated_at: now,
                    error_message: None,
                },
                UploadChunkManifest {
                    chunk_index: 1,
                    expected_bytes: chunk_bytes[1].len() as u64,
                    uploaded_bytes: chunk_bytes[1].len() as u64,
                    status: UploadChunkStatus::Uploaded,
                    checksum: Some(chunk_b_checksum),
                    updated_at: now,
                    error_message: None,
                },
            ],
        }
    }

    async fn seed_upload(storage: &Arc<dyn ExportStorage>, manifest: &UploadManifest) {
        storage
            .put_object(
                &upload_manifest_key(&manifest.recording_id, &manifest.upload_id),
                serde_json::to_vec_pretty(manifest).expect("serialize upload manifest"),
                "application/json",
            )
            .await
            .expect("store manifest");

        let chunk_keys = [b"chunk-a".to_vec(), b"chunk-b".to_vec()];

        for (chunk, bytes) in manifest.chunks.iter().zip(chunk_keys.into_iter()) {
            storage
                .put_object(
                    &format!(
                        "sessions/{}/participants/{}/recordings/{}/uploads/{}/chunks/{}",
                        manifest.session_id,
                        manifest.participant_id,
                        manifest.recording_id,
                        manifest.upload_id,
                        chunk.chunk_index
                    ),
                    bytes,
                    "video/webm",
                )
                .await
                .expect("store chunk");
        }
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};

        let digest = Sha256::digest(bytes);
        digest.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    #[tokio::test]
    async fn post_export_creates_export_and_returns_serialized_manifest() {
        let (router, storage, recording_id) = build_router_for_tests();
        let upload_id = "upload-1";
        let manifest = uploaded_manifest(&recording_id, upload_id);
        seed_upload(&storage, &manifest).await;

        let request = http::Request::builder()
            .method(http::Method::POST)
            .uri("/api/exports")
            .header(http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(
                serde_json::to_string(&request_payload(
                    &recording_id,
                    upload_id,
                    TARGET_RESOLUTION,
                ))
                .expect("serialize request"),
            ))
            .expect("request");

        let response = router.clone().oneshot(request).await.expect("response");
        assert_eq!(response.status(), StatusCode::CREATED);

        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        let payload: Value = serde_json::from_slice(&body).expect("parse response");
        assert_eq!(payload["recordingId"], recording_id);
        assert_eq!(payload["status"], "ready");

        let repeat_request = http::Request::builder()
            .method(http::Method::POST)
            .uri("/api/exports")
            .header(http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(
                serde_json::to_string(&request_payload(
                    &recording_id,
                    upload_id,
                    TARGET_RESOLUTION,
                ))
                .expect("serialize request"),
            ))
            .expect("request");
        let repeat_response = router.oneshot(repeat_request).await.expect("response");
        assert_eq!(repeat_response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn get_export_returns_not_found_for_unknown_export() {
        let (router, _, _) = build_router_for_tests();

        let request = http::Request::builder()
            .method(http::Method::GET)
            .uri("/api/exports/exp-unknown")
            .body(axum::body::Body::empty())
            .expect("request");

        let response = router.oneshot(request).await.expect("response");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn post_export_rejects_unsupported_targets() {
        let (router, _, recording_id) = build_router_for_tests();

        let request = http::Request::builder()
            .method(http::Method::POST)
            .uri("/api/exports")
            .header(http::header::CONTENT_TYPE, "application/json")
            .body(axum::body::Body::from(
                serde_json::to_string(&request_payload(&recording_id, "upload-1", "1280x720"))
                    .expect("serialize request"),
            ))
            .expect("request");

        let response = router.oneshot(request).await.expect("response");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
