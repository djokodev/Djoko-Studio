use std::{path::Path, sync::Arc};

use chrono::Utc;
use tokio::io::AsyncWriteExt;

use crate::{
    ffmpeg::FfmpegRunner,
    model::{
        export_id_for_recording, export_manifest_key, upload_manifest_key, CreateExportRequest,
        ExportFailure, ExportManifest, ExportReadyzResponse, ExportStatus, UploadManifest,
        UploadStatus, TARGET_FORMAT, TARGET_RESOLUTION,
    },
    storage::ExportStorage,
};

#[derive(Clone)]
pub struct ExportService {
    storage: Arc<dyn ExportStorage>,
    ffmpeg: Arc<dyn FfmpegRunner>,
}

#[derive(Debug, Clone)]
pub enum ExportServiceError {
    InvalidRequest { code: String, message: String },
    NotFound { code: String, message: String },
    Conflict { code: String, message: String },
    Unavailable { code: String, message: String },
    Processing { code: String, message: String },
    Internal { code: String, message: String },
}

impl ExportServiceError {
    pub fn invalid_request(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::InvalidRequest {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn not_found(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::NotFound {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn conflict(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Conflict {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::Unavailable {
            code: "storage_unavailable".to_string(),
            message: message.into(),
        }
    }

    pub fn processing(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Processing {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            code: "storage_error".to_string(),
            message: message.into(),
        }
    }

    pub fn code(&self) -> &str {
        match self {
            Self::InvalidRequest { code, .. }
            | Self::NotFound { code, .. }
            | Self::Conflict { code, .. }
            | Self::Unavailable { code, .. }
            | Self::Processing { code, .. }
            | Self::Internal { code, .. } => code,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Self::InvalidRequest { message, .. }
            | Self::NotFound { message, .. }
            | Self::Conflict { message, .. }
            | Self::Unavailable { message, .. }
            | Self::Processing { message, .. }
            | Self::Internal { message, .. } => message,
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(self, Self::Unavailable { .. } | Self::Internal { .. })
    }

    pub fn status_code(&self) -> http::StatusCode {
        match self {
            Self::InvalidRequest { .. } => http::StatusCode::BAD_REQUEST,
            Self::NotFound { .. } => http::StatusCode::NOT_FOUND,
            Self::Conflict { .. } => http::StatusCode::CONFLICT,
            Self::Unavailable { .. } => http::StatusCode::SERVICE_UNAVAILABLE,
            Self::Processing { .. } => http::StatusCode::UNPROCESSABLE_ENTITY,
            Self::Internal { .. } => http::StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl ExportService {
    pub fn new(storage: Arc<dyn ExportStorage>, ffmpeg: Arc<dyn FfmpegRunner>) -> Self {
        Self { storage, ffmpeg }
    }

    pub async fn readyz(&self) -> ExportReadyzResponse {
        let storage_ready = self.storage.ready().await;
        let ffmpeg_ready = self.ffmpeg.is_available().await;

        let storage_ok = storage_ready.is_ok();
        let ffmpeg_ok = ffmpeg_ready.is_ok();
        let storage_message = storage_ready.err().map(|error| error.message().to_string());
        let ffmpeg_message = ffmpeg_ready.err().map(|error| error.message().to_string());
        let message = storage_message.or(ffmpeg_message);

        let status = if message.is_none() { "ok" } else { "degraded" };

        ExportReadyzResponse {
            status: status.to_string(),
            service: "export-worker".to_string(),
            storage: if storage_ok {
                "ready".to_string()
            } else {
                "unavailable".to_string()
            },
            ffmpeg: if ffmpeg_ok {
                "available".to_string()
            } else {
                "unavailable".to_string()
            },
            message,
        }
    }

    pub async fn create_export(
        &self,
        request: CreateExportRequest,
    ) -> Result<(ExportManifest, bool), ExportServiceError> {
        validate_export_request(&request)?;
        let export_id = export_id_for_recording(&request.recording_id);
        let manifest_key = export_manifest_key(&export_id);

        if let Some(existing) = self.load_export_manifest(&manifest_key).await? {
            self.validate_request_matches_manifest(&request, &existing)?;
            return Ok((existing, false));
        }

        let now = Utc::now();
        let manifest = ExportManifest::new_processing(&request, now);
        self.store_export_manifest(&manifest_key, &manifest).await?;

        let outcome = self.process_export(&request, &manifest).await?;
        Ok((outcome, true))
    }

    pub async fn get_export(&self, export_id: &str) -> Result<ExportManifest, ExportServiceError> {
        let manifest = self.load_export_manifest_by_id(export_id).await?;
        manifest
            .ok_or_else(|| ExportServiceError::not_found("export_not_found", "Export not found."))
    }

    pub async fn download_export(&self, export_id: &str) -> Result<Vec<u8>, ExportServiceError> {
        let manifest = self.get_export(export_id).await?;

        if !manifest.is_completed() {
            return Err(ExportServiceError::processing(
                "export_not_ready",
                "Export is not ready for download yet.",
            ));
        }

        self.storage.get_object(&manifest.output_object_key).await
    }

    pub async fn process_export(
        &self,
        request: &CreateExportRequest,
        manifest: &ExportManifest,
    ) -> Result<ExportManifest, ExportServiceError> {
        match self.process_export_inner(request, manifest).await {
            Ok(ready_manifest) => Ok(ready_manifest),
            Err(error) => {
                self.mark_export_failed(manifest, &error).await?;
                Err(error)
            }
        }
    }

    async fn process_export_inner(
        &self,
        request: &CreateExportRequest,
        manifest: &ExportManifest,
    ) -> Result<ExportManifest, ExportServiceError> {
        let source = match self
            .load_upload_manifest(&manifest.source_manifest_key)
            .await?
        {
            Some(manifest) => manifest,
            None => {
                return self
                    .fail_export(
                        manifest,
                        "missing_manifest",
                        "Source upload manifest not found.",
                    )
                    .await
            }
        };

        self.validate_upload_manifest(&source, request, manifest)
            .await?;

        let temp_dir = tempfile::tempdir().map_err(|error| {
            ExportServiceError::internal(format!("Unable to create temp dir: {error}"))
        })?;
        let input_path = temp_dir.path().join("source.webm");
        let output_path = temp_dir.path().join("final.mp4");

        self.rebuild_webm(&source, &input_path).await?;
        self.ffmpeg
            .render(&input_path, &output_path, &request.target)
            .await?;

        let output_bytes = tokio::fs::read(&output_path).await.map_err(|error| {
            ExportServiceError::internal(format!("Unable to read FFmpeg output: {error}"))
        })?;
        self.storage
            .put_object(
                &manifest.output_object_key,
                output_bytes.clone(),
                "video/mp4",
            )
            .await?;

        let now = Utc::now();
        let mut ready_manifest = manifest.clone();
        ready_manifest.status = ExportStatus::Ready;
        ready_manifest.output_bytes = Some(output_bytes.len() as u64);
        ready_manifest.updated_at = now;
        ready_manifest.completed_at = Some(now);
        ready_manifest.error = None;
        self.store_export_manifest(&export_manifest_key(&manifest.export_id), &ready_manifest)
            .await?;

        Ok(ready_manifest)
    }

    async fn mark_export_failed(
        &self,
        manifest: &ExportManifest,
        error: &ExportServiceError,
    ) -> Result<(), ExportServiceError> {
        let mut failed = manifest.clone();
        failed.status = ExportStatus::Failed;
        failed.updated_at = Utc::now();
        failed.output_bytes = None;
        failed.completed_at = None;
        failed.error = Some(ExportFailure {
            code: error.code().to_string(),
            message: error.message().to_string(),
        });
        self.store_export_manifest(&export_manifest_key(&manifest.export_id), &failed)
            .await
    }

    async fn rebuild_webm(
        &self,
        source: &UploadManifest,
        input_path: &Path,
    ) -> Result<(), ExportServiceError> {
        let mut file = tokio::fs::File::create(input_path).await.map_err(|error| {
            ExportServiceError::internal(format!("Unable to create temp webm: {error}"))
        })?;

        for (expected_index, chunk) in source.chunks.iter().enumerate() {
            if chunk.chunk_index != expected_index as u32 {
                return self
                    .fail_export_from_source(
                        source,
                        "chunk_order_mismatch",
                        "Uploaded chunks are not in the expected order.",
                    )
                    .await
                    .map(|_| ());
            }

            let chunk_key = chunk_key_from_upload(source, chunk.chunk_index);
            let body = self.storage.get_object(&chunk_key).await?;
            if let Some(expected_checksum) = chunk.checksum.as_ref() {
                let actual_checksum = sha256_hex(&body);
                if actual_checksum != expected_checksum.trim() {
                    return self
                        .fail_export_from_source(
                            source,
                            "checksum_mismatch",
                            "Chunk checksum mismatch.",
                        )
                        .await
                        .map(|_| ());
                }
            }

            file.write_all(&body).await.map_err(|error| {
                ExportServiceError::internal(format!("Unable to write temp webm: {error}"))
            })?;
        }

        file.flush().await.map_err(|error| {
            ExportServiceError::internal(format!("Unable to flush temp webm: {error}"))
        })?;

        Ok(())
    }

    async fn validate_upload_manifest(
        &self,
        source: &UploadManifest,
        request: &CreateExportRequest,
        manifest: &ExportManifest,
    ) -> Result<(), ExportServiceError> {
        if source.status != UploadStatus::Uploaded {
            return self
                .fail_export(
                    manifest,
                    "upload_incomplete",
                    "Source upload is not complete yet.",
                )
                .await
                .map(|_| ());
        }

        if source.uploaded_chunk_count != source.expected_chunk_count {
            return self
                .fail_export(
                    manifest,
                    "incomplete_upload",
                    "Uploaded chunk count does not match the expected chunk count.",
                )
                .await
                .map(|_| ());
        }

        if source.uploaded_bytes != source.total_bytes {
            return self
                .fail_export(
                    manifest,
                    "incomplete_upload",
                    "Uploaded byte count does not match the expected total bytes.",
                )
                .await
                .map(|_| ());
        }

        if !source.uploaded_chunk_indexes().is_empty() {
            return self
                .fail_export(
                    manifest,
                    "missing_chunks",
                    "Some source chunks are missing.",
                )
                .await
                .map(|_| ());
        }

        if !source.rejected_chunk_indexes().is_empty() {
            return self
                .fail_export(
                    manifest,
                    "rejected_chunks",
                    "Some source chunks were rejected.",
                )
                .await
                .map(|_| ());
        }

        self.validate_request_matches_manifest(request, manifest)?;
        Ok(())
    }

    async fn fail_export(
        &self,
        manifest: &ExportManifest,
        code: &str,
        message: &str,
    ) -> Result<ExportManifest, ExportServiceError> {
        let mut failed = manifest.clone();
        let now = Utc::now();
        failed.status = ExportStatus::Failed;
        failed.updated_at = now;
        failed.completed_at = None;
        failed.output_bytes = None;
        failed.error = Some(ExportFailure {
            code: code.to_string(),
            message: message.to_string(),
        });
        self.store_export_manifest(&export_manifest_key(&manifest.export_id), &failed)
            .await?;

        Err(ExportServiceError::processing(
            code.to_string(),
            message.to_string(),
        ))
    }

    async fn fail_export_from_source(
        &self,
        source: &UploadManifest,
        code: &str,
        message: &str,
    ) -> Result<ExportManifest, ExportServiceError> {
        let export_id = export_id_for_recording(&source.recording_id);
        let output_object_key = crate::model::export_output_key(
            &source.session_id,
            &source.participant_id,
            &source.recording_id,
            &export_id,
        );
        let manifest = ExportManifest {
            manifest_version: 1,
            export_id,
            recording_id: source.recording_id.clone(),
            upload_id: source.upload_id.clone(),
            session_id: source.session_id.clone(),
            participant_id: source.participant_id.clone(),
            role: source.role,
            status: ExportStatus::Failed,
            target_format: TARGET_FORMAT.to_string(),
            target_resolution: TARGET_RESOLUTION.to_string(),
            source_manifest_key: upload_manifest_key(&source.recording_id, &source.upload_id),
            output_object_key,
            output_bytes: None,
            created_at: source.created_at,
            updated_at: Utc::now(),
            completed_at: None,
            error: Some(ExportFailure {
                code: code.to_string(),
                message: message.to_string(),
            }),
        };

        self.store_export_manifest(&export_manifest_key(&manifest.export_id), &manifest)
            .await?;

        Err(ExportServiceError::processing(
            code.to_string(),
            message.to_string(),
        ))
    }

    async fn load_export_manifest(
        &self,
        manifest_key: &str,
    ) -> Result<Option<ExportManifest>, ExportServiceError> {
        match self.storage.get_object(manifest_key).await {
            Ok(bytes) => serde_json::from_slice::<ExportManifest>(&bytes)
                .map(Some)
                .map_err(|error| {
                    ExportServiceError::internal(format!(
                        "Unable to parse export manifest: {error}"
                    ))
                }),
            Err(error) if error.code() == "export_not_found" => Ok(None),
            Err(error) => Err(error),
        }
    }

    async fn load_upload_manifest(
        &self,
        key: &str,
    ) -> Result<Option<UploadManifest>, ExportServiceError> {
        match self.storage.get_object(key).await {
            Ok(bytes) => serde_json::from_slice::<UploadManifest>(&bytes)
                .map(Some)
                .map_err(|error| {
                    ExportServiceError::internal(format!(
                        "Unable to parse source manifest: {error}"
                    ))
                }),
            Err(error) if error.code() == "export_not_found" => Ok(None),
            Err(error) => Err(error),
        }
    }

    async fn load_export_manifest_by_id(
        &self,
        export_id: &str,
    ) -> Result<Option<ExportManifest>, ExportServiceError> {
        self.load_export_manifest(&export_manifest_key(export_id))
            .await
    }

    async fn store_export_manifest(
        &self,
        manifest_key: &str,
        manifest: &ExportManifest,
    ) -> Result<(), ExportServiceError> {
        let payload = serde_json::to_vec_pretty(manifest).map_err(|error| {
            ExportServiceError::internal(format!("Unable to serialize export manifest: {error}"))
        })?;
        self.storage
            .put_object(manifest_key, payload, "application/json")
            .await
    }

    fn validate_request_matches_manifest(
        &self,
        request: &CreateExportRequest,
        manifest: &ExportManifest,
    ) -> Result<(), ExportServiceError> {
        if manifest.recording_id != request.recording_id.trim()
            || manifest.upload_id != request.upload_id.trim()
            || manifest.session_id != request.session_id.trim()
            || manifest.participant_id != request.participant_id.trim()
            || manifest.role != request.role
        {
            return Err(ExportServiceError::conflict(
                "export_mismatch",
                "Export request does not match the existing export manifest.",
            ));
        }

        Ok(())
    }
}

pub fn validate_export_request(request: &CreateExportRequest) -> Result<(), ExportServiceError> {
    if request.recording_id.trim().is_empty()
        || request.upload_id.trim().is_empty()
        || request.session_id.trim().is_empty()
        || request.participant_id.trim().is_empty()
    {
        return Err(ExportServiceError::invalid_request(
            "invalid_request",
            "All export identifiers are required.",
        ));
    }

    if request.target.format.trim() != TARGET_FORMAT
        || request.target.resolution.trim() != TARGET_RESOLUTION
    {
        return Err(ExportServiceError::invalid_request(
            "unsupported_target",
            "Only MP4 1920x1080 exports are supported in this slice.",
        ));
    }

    Ok(())
}

fn chunk_key_from_upload(source: &UploadManifest, chunk_index: u32) -> String {
    format!(
        "sessions/{}/participants/{}/recordings/{}/uploads/{}/chunks/{chunk_index}",
        source.session_id, source.participant_id, source.recording_id, source.upload_id
    )
}

impl UploadManifest {
    fn uploaded_chunk_indexes(&self) -> Vec<u32> {
        let expected: Vec<u32> = (0..self.expected_chunk_count).collect();
        let present = self
            .chunks
            .iter()
            .map(|chunk| chunk.chunk_index)
            .collect::<Vec<_>>();
        expected
            .into_iter()
            .filter(|index| !present.contains(index))
            .collect()
    }

    fn rejected_chunk_indexes(&self) -> Vec<u32> {
        self.chunks
            .iter()
            .filter(|chunk| chunk.status == crate::model::UploadChunkStatus::Rejected)
            .map(|chunk| chunk.chunk_index)
            .collect()
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::Arc;

    use chrono::{TimeZone, Utc};

    use crate::{
        ffmpeg::FakeFfmpegRunner,
        model::{UploadChunkStatus, UploadStatus},
        storage::{ExportStorage, StorageBackend},
    };

    fn service_with_memory_storage() -> (ExportService, Arc<dyn ExportStorage>) {
        let storage = StorageBackend::memory().into_shared();
        let service = ExportService::new(storage.clone(), Arc::new(FakeFfmpegRunner::available()));
        (service, storage)
    }

    fn timestamp() -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 6, 19, 10, 0, 0)
            .single()
            .expect("valid timestamp")
    }

    fn create_request(recording_id: &str, upload_id: &str) -> CreateExportRequest {
        CreateExportRequest {
            recording_id: recording_id.to_string(),
            upload_id: upload_id.to_string(),
            session_id: "session-1".to_string(),
            participant_id: "participant-1".to_string(),
            role: crate::model::ParticipantRole::Host,
            target: crate::model::ExportTargetRequest {
                format: TARGET_FORMAT.to_string(),
                resolution: TARGET_RESOLUTION.to_string(),
            },
        }
    }

    fn uploaded_manifest(
        recording_id: &str,
        upload_id: &str,
        chunk_bytes: &[Vec<u8>],
        chunks_in_order: bool,
        checksum_matches: bool,
    ) -> UploadManifest {
        let now = timestamp();
        let mut chunks = Vec::with_capacity(chunk_bytes.len());

        for (index, bytes) in chunk_bytes.iter().enumerate() {
            let actual_index = if chunks_in_order {
                index as u32
            } else if index == 0 && chunk_bytes.len() > 1 {
                1
            } else if index == 1 {
                0
            } else {
                index as u32
            };
            let checksum = if checksum_matches {
                Some(sha256_hex(bytes))
            } else {
                Some("deadbeef".to_string())
            };

            chunks.push(crate::model::UploadChunkManifest {
                chunk_index: actual_index,
                expected_bytes: bytes.len() as u64,
                uploaded_bytes: bytes.len() as u64,
                status: UploadChunkStatus::Uploaded,
                checksum,
                updated_at: now,
                error_message: None,
            });
        }

        UploadManifest {
            manifest_version: 1,
            recording_id: recording_id.to_string(),
            session_id: "session-1".to_string(),
            participant_id: "participant-1".to_string(),
            role: crate::model::ParticipantRole::Host,
            upload_id: upload_id.to_string(),
            status: UploadStatus::Uploaded,
            mime_type: Some("video/webm".to_string()),
            expected_chunk_count: chunk_bytes.len() as u32,
            chunk_size_bytes: chunk_bytes
                .first()
                .map(|bytes| bytes.len() as u64)
                .unwrap_or(0),
            total_bytes: chunk_bytes.iter().map(|bytes| bytes.len() as u64).sum(),
            uploaded_bytes: chunk_bytes.iter().map(|bytes| bytes.len() as u64).sum(),
            uploaded_chunk_count: chunk_bytes.len() as u32,
            created_at: now,
            updated_at: now,
            completed_at: Some(now),
            last_error: None,
            chunks,
        }
    }

    async fn seed_upload(
        storage: &Arc<dyn ExportStorage>,
        manifest: &UploadManifest,
        chunk_bytes: &[Vec<u8>],
    ) {
        let manifest_key = upload_manifest_key(&manifest.recording_id, &manifest.upload_id);
        storage
            .put_object(
                &manifest_key,
                serde_json::to_vec_pretty(manifest).expect("serialize upload manifest"),
                "application/json",
            )
            .await
            .expect("store manifest");

        for (index, bytes) in chunk_bytes.iter().enumerate() {
            let chunk_key = format!(
                "sessions/{}/participants/{}/recordings/{}/uploads/{}/chunks/{}",
                manifest.session_id,
                manifest.participant_id,
                manifest.recording_id,
                manifest.upload_id,
                index
            );
            storage
                .put_object(&chunk_key, bytes.clone(), "video/webm")
                .await
                .expect("store chunk");
        }
    }

    #[tokio::test]
    async fn readyz_reports_storage_and_ffmpeg_status() {
        let (service, _) = service_with_memory_storage();

        let response = service.readyz().await;
        assert_eq!(response.status, "ok");
        assert_eq!(response.storage, "ready");
        assert_eq!(response.ffmpeg, "available");
    }

    #[tokio::test]
    async fn create_export_fails_when_source_manifest_is_missing() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-1", "upload-1");

        let result = service.create_export(request.clone()).await;
        assert!(result.is_err());

        let export_id = export_id_for_recording(&request.recording_id);
        let manifest = service
            .get_export(&export_id)
            .await
            .expect("failed export manifest");
        assert_eq!(manifest.status, ExportStatus::Failed);
        assert_eq!(
            manifest.error.as_ref().map(|error| error.code.as_str()),
            Some("missing_manifest")
        );

        let exported_manifest_key = export_manifest_key(&export_id);
        let raw = storage
            .get_object(&exported_manifest_key)
            .await
            .expect("failed export object");
        let persisted: ExportManifest =
            serde_json::from_slice(&raw).expect("deserialize export manifest");
        assert_eq!(persisted.status, ExportStatus::Failed);
    }

    #[tokio::test]
    async fn create_export_fails_when_upload_is_incomplete() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-2", "upload-2");
        let manifest = UploadManifest {
            status: UploadStatus::Ready,
            ..uploaded_manifest(
                "recording-2",
                "upload-2",
                &[b"chunk-1".to_vec()],
                true,
                true,
            )
        };
        seed_upload(&storage, &manifest, &[b"chunk-1".to_vec()]).await;

        let result = service.create_export(request.clone()).await;
        assert!(result.is_err());

        let export_id = export_id_for_recording(&request.recording_id);
        let persisted = service
            .get_export(&export_id)
            .await
            .expect("failed export manifest");
        assert_eq!(persisted.status, ExportStatus::Failed);
        assert_eq!(
            persisted.error.as_ref().map(|error| error.code.as_str()),
            Some("upload_incomplete")
        );
    }

    #[tokio::test]
    async fn create_export_fails_when_chunks_are_out_of_order() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-3", "upload-3");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let manifest = uploaded_manifest("recording-3", "upload-3", &chunk_bytes, false, true);
        seed_upload(&storage, &manifest, &chunk_bytes).await;

        let result = service.create_export(request.clone()).await;
        assert!(result.is_err());

        let export_id = export_id_for_recording(&request.recording_id);
        let persisted = service
            .get_export(&export_id)
            .await
            .expect("failed export manifest");
        assert_eq!(
            persisted.error.as_ref().map(|error| error.code.as_str()),
            Some("chunk_order_mismatch")
        );
    }

    #[tokio::test]
    async fn create_export_fails_when_checksums_do_not_match() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-4", "upload-4");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let manifest = uploaded_manifest("recording-4", "upload-4", &chunk_bytes, true, false);
        seed_upload(&storage, &manifest, &chunk_bytes).await;

        let result = service.create_export(request.clone()).await;
        assert!(result.is_err());

        let export_id = export_id_for_recording(&request.recording_id);
        let persisted = service
            .get_export(&export_id)
            .await
            .expect("failed export manifest");
        assert_eq!(
            persisted.error.as_ref().map(|error| error.code.as_str()),
            Some("checksum_mismatch")
        );
    }

    #[tokio::test]
    async fn create_export_writes_completed_manifest_and_downloads_output() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-5", "upload-5");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let manifest = uploaded_manifest("recording-5", "upload-5", &chunk_bytes, true, true);
        seed_upload(&storage, &manifest, &chunk_bytes).await;

        let (created_manifest, created) = service
            .create_export(request.clone())
            .await
            .expect("export should complete");
        assert!(created);
        assert_eq!(created_manifest.status, ExportStatus::Ready);
        assert_eq!(
            created_manifest.output_bytes,
            Some(b"fake-mp4".len() as u64)
        );

        let export_id = export_id_for_recording(&request.recording_id);
        let persisted = service
            .get_export(&export_id)
            .await
            .expect("persisted export manifest");
        assert_eq!(persisted.status, ExportStatus::Ready);
        assert_eq!(persisted.output_bytes, Some(b"fake-mp4".len() as u64));

        let output = service
            .download_export(&export_id)
            .await
            .expect("download output");
        assert_eq!(output, b"fake-mp4".to_vec());
    }

    #[tokio::test]
    async fn download_export_rejects_unfinished_exports() {
        let (service, storage) = service_with_memory_storage();
        let export_id = export_id_for_recording("recording-6");
        let manifest = ExportManifest {
            manifest_version: 1,
            export_id: export_id.clone(),
            recording_id: "recording-6".to_string(),
            upload_id: "upload-6".to_string(),
            session_id: "session-1".to_string(),
            participant_id: "participant-1".to_string(),
            role: crate::model::ParticipantRole::Host,
            status: ExportStatus::Processing,
            target_format: TARGET_FORMAT.to_string(),
            target_resolution: TARGET_RESOLUTION.to_string(),
            source_manifest_key: upload_manifest_key("recording-6", "upload-6"),
            output_object_key: crate::model::export_output_key(
                "session-1",
                "participant-1",
                "recording-6",
                &export_id,
            ),
            output_bytes: None,
            created_at: timestamp(),
            updated_at: timestamp(),
            completed_at: None,
            error: None,
        };

        storage
            .put_object(
                &export_manifest_key(&export_id),
                serde_json::to_vec_pretty(&manifest).expect("serialize export manifest"),
                "application/json",
            )
            .await
            .expect("seed manifest");

        let err = service
            .download_export(&export_id)
            .await
            .expect_err("unfinished export should fail");
        assert_eq!(err.code(), "export_not_ready");
    }

    #[tokio::test]
    async fn unknown_export_returns_not_found() {
        let (service, _) = service_with_memory_storage();

        let err = service
            .get_export("exp-unknown")
            .await
            .expect_err("missing export should fail");
        assert_eq!(err.code(), "export_not_found");
    }
}
