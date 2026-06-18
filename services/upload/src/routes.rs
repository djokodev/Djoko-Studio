use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

use crate::{
    model::{CreateUploadSessionRequest, UploadChunkRequest, UploadServiceError},
    storage::{error_to_envelope, status_code_for_error, UploadBackend},
};

const SERVICE_NAME: &str = "upload";

#[derive(Clone)]
pub struct AppState {
    pub backend: UploadBackend,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StatusResponse {
    pub status: String,
    pub service: String,
    pub storage: String,
    pub message: Option<String>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route(
            "/api/recordings/{recording_id}/uploads",
            post(create_upload),
        )
        .route(
            "/api/recordings/{recording_id}/uploads/{upload_id}",
            get(get_upload_status),
        )
        .route(
            "/api/recordings/{recording_id}/uploads/{upload_id}/chunks/{chunk_index}",
            put(upload_chunk),
        )
        .route(
            "/api/recordings/{recording_id}/uploads/{upload_id}/complete",
            post(complete_upload),
        )
        .route(
            "/api/recordings/{recording_id}/uploads/{upload_id}/cancel",
            post(cancel_upload),
        )
        .layer(cors_layer())
        .with_state(state)
}

async fn healthz(State(state): State<AppState>) -> impl IntoResponse {
    Json(StatusResponse {
        status: "ok".to_string(),
        service: SERVICE_NAME.to_string(),
        storage: if state.backend.is_ready() {
            "ready".to_string()
        } else {
            "unavailable".to_string()
        },
        message: None,
    })
}

async fn readyz(State(state): State<AppState>) -> Response {
    if state.backend.is_ready() {
        return (
            StatusCode::OK,
            Json(StatusResponse {
                status: "ok".to_string(),
                service: SERVICE_NAME.to_string(),
                storage: "ready".to_string(),
                message: None,
            }),
        )
            .into_response();
    }

    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(StatusResponse {
            status: "error".to_string(),
            service: SERVICE_NAME.to_string(),
            storage: "unavailable".to_string(),
            message: state.backend.readiness_message().map(ToOwned::to_owned),
        }),
    )
        .into_response()
}

async fn create_upload(
    State(state): State<AppState>,
    Path(recording_id): Path<String>,
    Json(mut request): Json<CreateUploadSessionRequest>,
) -> Response {
    request.recording_id = recording_id;

    match state.backend.create_upload(request).await {
        Ok(response) => (StatusCode::CREATED, Json(response)).into_response(),
        Err(error) => error_response(error),
    }
}

async fn get_upload_status(
    State(state): State<AppState>,
    Path((recording_id, upload_id)): Path<(String, String)>,
) -> Response {
    match state.backend.get_status(&recording_id, &upload_id).await {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(error) => error_response(error),
    }
}

async fn upload_chunk(
    State(state): State<AppState>,
    Path((recording_id, upload_id, chunk_index)): Path<(String, String, u32)>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    match parse_chunk_request(recording_id, upload_id, chunk_index, headers, body) {
        Ok(request) => match state.backend.upload_chunk(request).await {
            Ok(response) => (StatusCode::OK, Json(response)).into_response(),
            Err(error) => error_response(error),
        },
        Err(error) => error_response(error),
    }
}

async fn complete_upload(
    State(state): State<AppState>,
    Path((recording_id, upload_id)): Path<(String, String)>,
) -> Response {
    match state
        .backend
        .complete_upload(&recording_id, &upload_id)
        .await
    {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(error) => error_response(error),
    }
}

async fn cancel_upload(
    State(state): State<AppState>,
    Path((recording_id, upload_id)): Path<(String, String)>,
) -> Response {
    match state.backend.cancel_upload(&recording_id, &upload_id).await {
        Ok(response) => (StatusCode::OK, Json(response)).into_response(),
        Err(error) => error_response(error),
    }
}

fn parse_chunk_request(
    recording_id: String,
    upload_id: String,
    chunk_index: u32,
    headers: HeaderMap,
    body: Bytes,
) -> Result<UploadChunkRequest, UploadServiceError> {
    let total_bytes = parse_required_u64_header(&headers, "x-dna-total-bytes")?;
    let chunk_size_bytes = parse_required_u64_header(&headers, "x-dna-chunk-size")?;
    let idempotency_key = parse_required_string_header(&headers, "x-dna-idempotency-key")?;
    let chunk_checksum = parse_optional_string_header(&headers, "x-dna-chunk-checksum");
    let mime_type = parse_required_string_header(&headers, header::CONTENT_TYPE.as_str())?;

    Ok(UploadChunkRequest {
        recording_id,
        upload_id,
        chunk_index,
        chunk_size_bytes,
        total_bytes,
        mime_type,
        idempotency_key,
        body: body.to_vec(),
        chunk_checksum,
    })
}

fn parse_required_u64_header(headers: &HeaderMap, name: &str) -> Result<u64, UploadServiceError> {
    let value = parse_required_string_header(headers, name)?;
    value.parse::<u64>().map_err(|_| {
        UploadServiceError::validation(
            "invalid_metadata",
            format!("Header {name} must be a positive integer."),
            false,
        )
    })
}

fn parse_required_string_header(
    headers: &HeaderMap,
    name: &str,
) -> Result<String, UploadServiceError> {
    let value = headers.get(name).ok_or_else(|| {
        UploadServiceError::validation(
            "invalid_metadata",
            format!("Header {name} is required."),
            false,
        )
    })?;

    let string_value = value.to_str().map_err(|_| {
        UploadServiceError::validation(
            "invalid_metadata",
            format!("Header {name} must be valid ASCII."),
            false,
        )
    })?;

    let trimmed = string_value.trim().to_string();
    if trimmed.is_empty() {
        return Err(UploadServiceError::validation(
            "invalid_metadata",
            format!("Header {name} is required."),
            false,
        ));
    }

    Ok(trimmed)
}

fn parse_optional_string_header(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn error_response(error: UploadServiceError) -> Response {
    let status = status_code_for_error(&error);
    let envelope = error_to_envelope(&error);
    (status, Json(envelope)).into_response()
}

fn cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        CancelUploadSessionResponse, CompleteUploadSessionResponse, CreateUploadSessionResponse,
        GetUploadSessionStatusResponse, UploadChunkResponse,
    };
    use axum::http::Method;
    use axum::{body::to_bytes, body::Body, http::Request};
    use chrono::Utc;
    use std::sync::OnceLock;
    use tower::ServiceExt;

    fn app() -> Router {
        static BACKEND: OnceLock<UploadBackend> = OnceLock::new();

        router(AppState {
            backend: BACKEND.get_or_init(UploadBackend::in_memory).clone(),
        })
    }

    async fn request(
        method: Method,
        uri: &str,
        headers: &[(&str, &str)],
        body: impl Into<Body>,
    ) -> axum::response::Response {
        let mut builder = Request::builder().method(method).uri(uri);
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }

        app()
            .oneshot(builder.body(body.into()).expect("build request"))
            .await
            .expect("response")
    }

    async fn create_upload_session() -> CreateUploadSessionResponse {
        let response = request(
            Method::POST,
            "/api/recordings/recording-1/uploads",
            &[("content-type", "application/json")],
            Body::from(
                serde_json::json!({
                    "recordingId": "ignored",
                    "sessionId": "session-1",
                    "participantId": "participant-1",
                    "role": "host",
                    "totalBytes": 5,
                    "expectedChunkCount": 2,
                    "chunkSizeBytes": 2,
                    "mimeType": "video/webm",
                    "manifestVersion": 1,
                    "clientCreatedAt": Utc::now(),
                })
                .to_string(),
            ),
        )
        .await;

        assert_eq!(response.status(), StatusCode::CREATED);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        serde_json::from_slice(&body).expect("parse create response")
    }

    #[tokio::test]
    async fn healthz_returns_ok_json() {
        let response = request(Method::GET, "/healthz", &[], Body::empty()).await;
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn readyz_returns_ok_when_storage_is_ready() {
        let response = request(Method::GET, "/readyz", &[], Body::empty()).await;
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn readyz_returns_service_unavailable_when_storage_is_missing() {
        let response = router(AppState {
            backend: UploadBackend::Unconfigured {
                message: "S3_ENDPOINT is not configured.".to_string(),
            },
        })
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri("/readyz")
                .body(Body::empty())
                .expect("build request"),
        )
        .await
        .expect("response");

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        let payload: StatusResponse = serde_json::from_slice(&body).expect("parse response");
        assert_eq!(payload.storage, "unavailable");
    }

    #[tokio::test]
    async fn create_upload_session_returns_session_metadata() {
        let response = request(
            Method::POST,
            "/api/recordings/recording-1/uploads",
            &[("content-type", "application/json")],
            Body::from(
                serde_json::json!({
                    "recordingId": "recording-1",
                    "sessionId": "session-1",
                    "participantId": "participant-1",
                    "role": "host",
                    "totalBytes": 5,
                    "expectedChunkCount": 2,
                    "chunkSizeBytes": 2,
                    "mimeType": "video/webm",
                    "manifestVersion": 1,
                    "clientCreatedAt": Utc::now(),
                })
                .to_string(),
            ),
        )
        .await;

        assert_eq!(response.status(), StatusCode::CREATED);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        let payload: CreateUploadSessionResponse =
            serde_json::from_slice(&body).expect("parse response");
        assert_eq!(payload.recording_id, "recording-1");
        assert_eq!(payload.expected_chunk_count, 2);
        assert_eq!(payload.status, crate::model::UploadSessionStatus::Ready);
    }

    #[tokio::test]
    async fn duplicate_chunk_upload_is_idempotent() {
        let created = create_upload_session().await;
        let headers = [
            ("content-type", "video/webm"),
            ("x-dna-total-bytes", "5"),
            ("x-dna-chunk-size", "3"),
            ("x-dna-idempotency-key", "idempotency-1"),
            (
                "x-dna-chunk-checksum",
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ),
        ];

        let first = request(
            Method::PUT,
            &format!(
                "/api/recordings/{}/uploads/{}/chunks/0",
                created.recording_id, created.upload_id
            ),
            &headers,
            Body::from("abc"),
        )
        .await;
        assert_eq!(first.status(), StatusCode::OK);

        let second = request(
            Method::PUT,
            &format!(
                "/api/recordings/{}/uploads/{}/chunks/0",
                created.recording_id, created.upload_id
            ),
            &headers,
            Body::from("abc"),
        )
        .await;
        assert_eq!(second.status(), StatusCode::OK);
        let body = to_bytes(second.into_body(), usize::MAX)
            .await
            .expect("read body");
        let payload: UploadChunkResponse = serde_json::from_slice(&body).expect("parse response");
        assert!(payload.already_present);
    }

    #[tokio::test]
    async fn status_endpoint_reports_missing_chunks() {
        let created = create_upload_session().await;
        let response = request(
            Method::GET,
            &format!(
                "/api/recordings/{}/uploads/{}",
                created.recording_id, created.upload_id
            ),
            &[],
            Body::empty(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        let payload: GetUploadSessionStatusResponse =
            serde_json::from_slice(&body).expect("parse response");
        assert_eq!(payload.missing_chunk_indexes, vec![0, 1]);
    }

    #[tokio::test]
    async fn complete_upload_returns_incomplete_when_chunks_are_missing() {
        let created = create_upload_session().await;
        let response = request(
            Method::POST,
            &format!(
                "/api/recordings/{}/uploads/{}/complete",
                created.recording_id, created.upload_id
            ),
            &[],
            Body::empty(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        let payload: CompleteUploadSessionResponse =
            serde_json::from_slice(&body).expect("parse response");
        assert!(!payload.complete);
        assert_eq!(
            payload.status,
            crate::model::UploadSessionStatus::Incomplete
        );
        assert_eq!(payload.missing_chunk_indexes, vec![0, 1]);
    }

    #[tokio::test]
    async fn invalid_chunk_index_returns_bad_request() {
        let created = create_upload_session().await;
        let response = request(
            Method::PUT,
            &format!(
                "/api/recordings/{}/uploads/{}/chunks/2",
                created.recording_id, created.upload_id
            ),
            &[
                ("content-type", "video/webm"),
                ("x-dna-total-bytes", "5"),
                ("x-dna-chunk-size", "2"),
                ("x-dna-idempotency-key", "idempotency-invalid-index"),
            ],
            Body::from("z"),
        )
        .await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn empty_chunk_returns_bad_request() {
        let created = create_upload_session().await;
        let response = request(
            Method::PUT,
            &format!(
                "/api/recordings/{}/uploads/{}/chunks/0",
                created.recording_id, created.upload_id
            ),
            &[
                ("content-type", "video/webm"),
                ("x-dna-total-bytes", "5"),
                ("x-dna-chunk-size", "2"),
                ("x-dna-idempotency-key", "idempotency-empty-body"),
            ],
            Body::empty(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn complete_upload_marks_session_uploaded_when_all_chunks_present() {
        let created = create_upload_session().await;

        let _ = request(
            Method::PUT,
            &format!(
                "/api/recordings/{}/uploads/{}/chunks/0",
                created.recording_id, created.upload_id
            ),
            &[
                ("content-type", "video/webm"),
                ("x-dna-total-bytes", "5"),
                ("x-dna-chunk-size", "2"),
                ("x-dna-idempotency-key", "idempotency-1"),
                ("x-dna-chunk-checksum", "checksum-a"),
            ],
            Body::from("ab"),
        )
        .await;

        let _ = request(
            Method::PUT,
            &format!(
                "/api/recordings/{}/uploads/{}/chunks/1",
                created.recording_id, created.upload_id
            ),
            &[
                ("content-type", "video/webm"),
                ("x-dna-total-bytes", "5"),
                ("x-dna-chunk-size", "3"),
                ("x-dna-idempotency-key", "idempotency-2"),
                ("x-dna-chunk-checksum", "checksum-b"),
            ],
            Body::from("cde"),
        )
        .await;

        let response = request(
            Method::POST,
            &format!(
                "/api/recordings/{}/uploads/{}/complete",
                created.recording_id, created.upload_id
            ),
            &[],
            Body::empty(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        let payload: CompleteUploadSessionResponse =
            serde_json::from_slice(&body).expect("parse response");
        assert!(payload.complete);
        assert_eq!(payload.status, crate::model::UploadSessionStatus::Uploaded);
        assert_eq!(payload.uploaded_bytes, 5);
    }

    #[tokio::test]
    async fn cancel_upload_marks_session_canceled() {
        let created = create_upload_session().await;
        let response = request(
            Method::POST,
            &format!(
                "/api/recordings/{}/uploads/{}/cancel",
                created.recording_id, created.upload_id
            ),
            &[],
            Body::empty(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        let payload: CancelUploadSessionResponse =
            serde_json::from_slice(&body).expect("parse response");
        assert_eq!(payload.status, crate::model::UploadSessionStatus::Canceled);
    }

    #[tokio::test]
    async fn invalid_chunk_metadata_returns_bad_request() {
        let created = create_upload_session().await;
        let response = request(
            Method::PUT,
            &format!(
                "/api/recordings/{}/uploads/{}/chunks/0",
                created.recording_id, created.upload_id
            ),
            &[("content-type", "video/webm")],
            Body::from("abc"),
        )
        .await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
