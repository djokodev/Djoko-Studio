use std::{collections::HashSet, path::Path, sync::Arc, time::Duration};

use chrono::{TimeDelta, Utc};
use tokio::io::AsyncWriteExt;
use tracing::{error, warn};

use crate::{
    ffmpeg::FfmpegRunner,
    model::{
        export_id_for_recording, export_manifest_key, CreateExportRequest, ExportFailure,
        ExportManifest, ExportReadyzResponse, ExportStatus, UploadChunkManifest, UploadChunkStatus,
        UploadManifest, UploadStatus, TARGET_FORMAT, TARGET_RESOLUTION,
    },
    storage::{ExportDownloadBody, ExportStorage},
};

#[derive(Clone)]
pub struct ExportService {
    storage: Arc<dyn ExportStorage>,
    ffmpeg: Arc<dyn FfmpegRunner>,
    processing_stale_after: TimeDelta,
}

pub struct ExportDownload {
    pub body: ExportDownloadBody,
    pub content_length: Option<u64>,
}

pub struct ExportCreateResult {
    pub manifest: ExportManifest,
    pub status_code: http::StatusCode,
}

impl std::fmt::Debug for ExportDownload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let body_kind = match &self.body {
            ExportDownloadBody::Bytes(_) => "bytes",
            ExportDownloadBody::Stream(_) => "stream",
        };

        f.debug_struct("ExportDownload")
            .field("body", &body_kind)
            .field("content_length", &self.content_length)
            .finish()
    }
}

#[derive(Debug, Clone)]
pub enum ExportServiceError {
    InvalidRequest {
        code: String,
        message: String,
    },
    NotFound {
        code: String,
        message: String,
    },
    Conflict {
        code: String,
        message: String,
    },
    Unavailable {
        code: String,
        message: String,
    },
    Processing {
        code: String,
        message: String,
        retryable: bool,
    },
    Internal {
        code: String,
        message: String,
    },
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
            retryable: false,
        }
    }

    pub fn processing_retryable(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Processing {
            code: code.into(),
            message: message.into(),
            retryable: true,
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
        match self {
            Self::Unavailable { .. } | Self::Internal { .. } => true,
            Self::Processing { retryable, .. } => *retryable,
            _ => false,
        }
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
        Self::with_processing_stale_after(
            storage,
            ffmpeg,
            duration_from_env("PROCESSING_STALE_AFTER_SECONDS", 1800),
        )
    }

    pub fn with_processing_stale_after(
        storage: Arc<dyn ExportStorage>,
        ffmpeg: Arc<dyn FfmpegRunner>,
        processing_stale_after: Duration,
    ) -> Self {
        let processing_stale_after = TimeDelta::from_std(processing_stale_after)
            .unwrap_or_else(|_| TimeDelta::seconds(1800));

        Self {
            storage,
            ffmpeg,
            processing_stale_after,
        }
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
    ) -> Result<ExportCreateResult, ExportServiceError> {
        validate_export_request(&request)?;
        let export_id = export_id_for_recording(&request.recording_id);
        let manifest_key = export_manifest_key(&export_id);
        let now = Utc::now();

        if let Some(existing) = self.load_export_manifest(&manifest_key).await? {
            self.validate_request_matches_manifest(&request, &existing)?;
            return match existing.status {
                ExportStatus::Ready => Ok(ExportCreateResult {
                    manifest: existing,
                    status_code: http::StatusCode::OK,
                }),
                ExportStatus::Processing | ExportStatus::Pending
                    if self.processing_manifest_is_stale(&existing, now) =>
                {
                    let restarted = existing.restart_processing(now);
                    self.store_export_manifest(&manifest_key, &restarted)
                        .await?;
                    self.spawn_export_task(request.clone(), restarted.clone());
                    Ok(ExportCreateResult {
                        manifest: restarted,
                        status_code: http::StatusCode::ACCEPTED,
                    })
                }
                ExportStatus::Processing | ExportStatus::Pending => Ok(ExportCreateResult {
                    manifest: existing,
                    status_code: http::StatusCode::OK,
                }),
                ExportStatus::Failed => {
                    let restarted = existing.restart_processing(now);
                    self.store_export_manifest(&manifest_key, &restarted)
                        .await?;
                    self.spawn_export_task(request.clone(), restarted.clone());
                    Ok(ExportCreateResult {
                        manifest: restarted,
                        status_code: http::StatusCode::ACCEPTED,
                    })
                }
            };
        }

        let manifest = ExportManifest::new_processing(&request, now);
        self.store_export_manifest(&manifest_key, &manifest).await?;
        self.spawn_export_task(request, manifest.clone());
        Ok(ExportCreateResult {
            manifest,
            status_code: http::StatusCode::ACCEPTED,
        })
    }

    pub async fn get_export(&self, export_id: &str) -> Result<ExportManifest, ExportServiceError> {
        let manifest = self.load_export_manifest_by_id(export_id).await?;
        manifest
            .ok_or_else(|| ExportServiceError::not_found("export_not_found", "Export not found."))
    }

    pub async fn download_export(
        &self,
        export_id: &str,
    ) -> Result<ExportDownload, ExportServiceError> {
        let manifest = self.get_export(export_id).await?;

        if !manifest.is_completed() {
            return Err(ExportServiceError::processing(
                "export_not_ready",
                "Export is not ready for download yet.",
            ));
        }

        let body = self
            .storage
            .get_file_object(&manifest.output_object_key)
            .await?;
        Ok(ExportDownload {
            body,
            content_length: manifest.output_bytes,
        })
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

    fn processing_manifest_is_stale(
        &self,
        manifest: &ExportManifest,
        now: chrono::DateTime<Utc>,
    ) -> bool {
        now.signed_duration_since(manifest.updated_at) > self.processing_stale_after
    }

    fn spawn_export_task(&self, request: CreateExportRequest, manifest: ExportManifest) {
        let service = self.clone();
        tokio::spawn(async move {
            if let Err(error) = service.process_export(&request, &manifest).await {
                error!(
                    export_id = %manifest.export_id,
                    recording_id = %manifest.recording_id,
                    attempt_id = %manifest.attempt_id,
                    error_code = error.code(),
                    error_message = error.message(),
                    "background export processing failed"
                );
            }
        });
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

        let temp_dir = tempfile::tempdir().map_err(|error| {
            ExportServiceError::internal(format!("Unable to create temp dir: {error}"))
        })?;
        let input_path = temp_dir.path().join("source.webm");
        let output_path = temp_dir.path().join("final.mp4");

        let chunks = self
            .validate_upload_manifest(&source, request, manifest)
            .await?;
        self.rebuild_webm(&source, &chunks, manifest, &input_path)
            .await?;
        self.ffmpeg
            .render(&input_path, &output_path, &request.target)
            .await?;

        let output_bytes = tokio::fs::metadata(&output_path)
            .await
            .map_err(|error| {
                ExportServiceError::internal(format!("Unable to stat FFmpeg output: {error}"))
            })?
            .len();
        self.storage
            .put_file_object(&manifest.output_object_key, &output_path, "video/mp4")
            .await?;

        let now = Utc::now();
        let mut ready_manifest = manifest.clone();
        ready_manifest.status = ExportStatus::Ready;
        ready_manifest.output_bytes = Some(output_bytes);
        ready_manifest.updated_at = now;
        ready_manifest.completed_at = Some(now);
        ready_manifest.error = None;
        self.store_terminal_manifest_if_current_attempt(&ready_manifest)
            .await
    }

    async fn rebuild_webm(
        &self,
        source: &UploadManifest,
        chunks: &[UploadChunkManifest],
        manifest: &ExportManifest,
        input_path: &Path,
    ) -> Result<(), ExportServiceError> {
        let mut file = tokio::fs::File::create(input_path).await.map_err(|error| {
            ExportServiceError::internal(format!("Unable to create temp webm: {error}"))
        })?;

        for chunk in chunks {
            let chunk_key = chunk_key_from_upload(source, chunk.chunk_index);
            let body = self.storage.get_object(&chunk_key).await?;
            if let Some(expected_checksum) = chunk.checksum.as_ref() {
                let actual_checksum = sha256_hex(&body);
                if actual_checksum != expected_checksum.trim() {
                    self.fail_export(manifest, "checksum_mismatch", "Chunk checksum mismatch.")
                        .await?;
                    unreachable!("fail_export always returns an error");
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
        let _ = self
            .store_terminal_manifest_if_current_attempt(&failed)
            .await?;
        Ok(())
    }

    async fn store_terminal_manifest_if_current_attempt(
        &self,
        next_manifest: &ExportManifest,
    ) -> Result<ExportManifest, ExportServiceError> {
        let manifest_key = export_manifest_key(&next_manifest.export_id);
        let Some(current_manifest) = self.load_export_manifest(&manifest_key).await? else {
            warn!(
                export_id = %next_manifest.export_id,
                attempt_id = %next_manifest.attempt_id,
                "skipping terminal export manifest write because current manifest is missing"
            );
            return Ok(next_manifest.clone());
        };

        if current_manifest.attempt_id != next_manifest.attempt_id
            || current_manifest.status != ExportStatus::Processing
        {
            warn!(
                export_id = %next_manifest.export_id,
                recording_id = %next_manifest.recording_id,
                attempt_id = %next_manifest.attempt_id,
                current_attempt_id = %current_manifest.attempt_id,
                current_status = ?current_manifest.status,
                next_status = ?next_manifest.status,
                "skipping obsolete export attempt terminal write"
            );
            return Ok(current_manifest);
        }

        self.store_export_manifest(&manifest_key, next_manifest)
            .await?;
        Ok(next_manifest.clone())
    }

    async fn validate_upload_manifest(
        &self,
        source: &UploadManifest,
        request: &CreateExportRequest,
        manifest: &ExportManifest,
    ) -> Result<Vec<UploadChunkManifest>, ExportServiceError> {
        if source.status != UploadStatus::Uploaded {
            self.fail_export(
                manifest,
                "upload_incomplete",
                "Source upload is not complete yet.",
            )
            .await?;
            unreachable!("fail_export always returns an error");
        }

        if source.uploaded_chunk_count != source.expected_chunk_count {
            self.fail_export(
                manifest,
                "incomplete_upload",
                "Uploaded chunk count does not match the expected chunk count.",
            )
            .await?;
            unreachable!("fail_export always returns an error");
        }

        if source.uploaded_bytes != source.total_bytes {
            self.fail_export(
                manifest,
                "incomplete_upload",
                "Uploaded byte count does not match the expected total bytes.",
            )
            .await?;
            unreachable!("fail_export always returns an error");
        }

        let mut chunks = source.chunks.clone();
        chunks.sort_by_key(|chunk| chunk.chunk_index);

        let mut seen = HashSet::new();
        for (expected_index, chunk) in chunks.iter().enumerate() {
            if !seen.insert(chunk.chunk_index) {
                self.fail_export(
                    manifest,
                    "duplicate_chunk_indexes",
                    "Some source chunks are duplicated.",
                )
                .await?;
                unreachable!("fail_export always returns an error");
            }

            if chunk.chunk_index != expected_index as u32 {
                self.fail_export(
                    manifest,
                    "missing_chunks",
                    "Some source chunks are missing.",
                )
                .await?;
                unreachable!("fail_export always returns an error");
            }

            if !matches!(
                chunk.status,
                UploadChunkStatus::Uploaded | UploadChunkStatus::AlreadyPresent
            ) {
                self.fail_export(
                    manifest,
                    "failed_chunk_status",
                    "Some source chunks are not ready for export.",
                )
                .await?;
                unreachable!("fail_export always returns an error");
            }

            if chunk.expected_bytes == 0 || chunk.uploaded_bytes != chunk.expected_bytes {
                self.fail_export(
                    manifest,
                    "chunk_byte_mismatch",
                    "A source chunk has unexpected byte counts.",
                )
                .await?;
                unreachable!("fail_export always returns an error");
            }
        }

        if chunks.len() as u32 != source.expected_chunk_count {
            self.fail_export(
                manifest,
                "missing_chunks",
                "Some source chunks are missing.",
            )
            .await?;
            unreachable!("fail_export always returns an error");
        }

        self.validate_request_matches_manifest(request, manifest)?;
        Ok(chunks)
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
        let _ = self
            .store_terminal_manifest_if_current_attempt(&failed)
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

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};

    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn duration_from_env(name: &str, default_seconds: u64) -> Duration {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or_else(|| Duration::from_secs(default_seconds))
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::{
        collections::HashMap,
        path::{Path, PathBuf},
        sync::atomic::{AtomicUsize, Ordering},
        sync::Arc,
        time::Duration,
    };

    use chrono::{TimeZone, Utc};
    use tokio::{
        io::AsyncWriteExt,
        sync::{Mutex, Notify},
        time::{sleep, timeout},
    };

    use crate::{
        ffmpeg::FakeFfmpegRunner,
        model::{upload_manifest_key, UploadChunkStatus, UploadStatus},
        storage::{ExportStorage, ObjectData, StorageBackend},
    };

    fn service_with_memory_storage() -> (ExportService, Arc<dyn ExportStorage>) {
        let storage = StorageBackend::memory().into_shared();
        let service = ExportService::new(storage.clone(), Arc::new(FakeFfmpegRunner::available()));
        (service, storage)
    }

    fn service_with_custom_storage(
        storage: Arc<RecordingStorage>,
        ffmpeg: Arc<dyn FfmpegRunner>,
    ) -> (ExportService, Arc<RecordingStorage>) {
        let service = ExportService::with_processing_stale_after(
            storage.clone(),
            ffmpeg,
            Duration::from_secs(1800),
        );
        (service, storage)
    }

    fn service_with_custom_stale_after(
        storage: Arc<dyn ExportStorage>,
        ffmpeg: Arc<dyn FfmpegRunner>,
        stale_after: Duration,
    ) -> ExportService {
        ExportService::with_processing_stale_after(storage, ffmpeg, stale_after)
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

        for (chunk, bytes) in manifest.chunks.iter().zip(chunk_bytes.iter()) {
            let chunk_key = format!(
                "sessions/{}/participants/{}/recordings/{}/uploads/{}/chunks/{}",
                manifest.session_id,
                manifest.participant_id,
                manifest.recording_id,
                manifest.upload_id,
                chunk.chunk_index
            );
            storage
                .put_object(&chunk_key, bytes.clone(), "video/webm")
                .await
                .expect("store chunk");
        }
    }

    fn failed_export_manifest(recording_id: &str, upload_id: &str) -> ExportManifest {
        let mut manifest =
            ExportManifest::new_processing(&create_request(recording_id, upload_id), timestamp());
        manifest.status = ExportStatus::Failed;
        manifest.updated_at = timestamp();
        manifest.error = Some(ExportFailure {
            code: "previous_failure".to_string(),
            message: "previous failure".to_string(),
        });
        manifest
    }

    async fn wait_for_export_status(
        service: &ExportService,
        export_id: &str,
        status: ExportStatus,
    ) -> ExportManifest {
        timeout(Duration::from_secs(1), async {
            loop {
                let manifest = service
                    .get_export(export_id)
                    .await
                    .expect("export manifest should exist");
                if manifest.status == status {
                    return manifest;
                }
                sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("timed out waiting for export status")
    }

    #[derive(Clone)]
    struct RecordingStorage {
        objects: Arc<Mutex<HashMap<String, ObjectData>>>,
        file_put_paths: Arc<Mutex<Vec<PathBuf>>>,
        stream_download: bool,
        download_bytes: Vec<u8>,
    }

    impl RecordingStorage {
        fn new(stream_download: bool, download_bytes: Vec<u8>) -> Self {
            Self {
                objects: Arc::new(Mutex::new(HashMap::new())),
                file_put_paths: Arc::new(Mutex::new(Vec::new())),
                stream_download,
                download_bytes,
            }
        }

        async fn file_put_paths(&self) -> Vec<PathBuf> {
            self.file_put_paths.lock().await.clone()
        }
    }

    #[async_trait::async_trait]
    impl ExportStorage for RecordingStorage {
        async fn ready(&self) -> Result<(), ExportServiceError> {
            Ok(())
        }

        async fn get_object(&self, key: &str) -> Result<Vec<u8>, ExportServiceError> {
            let objects = self.objects.lock().await;
            let Some(object) = objects.get(key) else {
                return Err(ExportServiceError::not_found(
                    "export_not_found",
                    "Export asset not found.",
                ));
            };

            Ok(object.bytes.clone())
        }

        async fn get_file_object(
            &self,
            key: &str,
        ) -> Result<ExportDownloadBody, ExportServiceError> {
            if self.stream_download {
                let bytes = if self.download_bytes.is_empty() {
                    self.get_object(key).await?
                } else {
                    self.download_bytes.clone()
                };
                let (mut writer, reader) = tokio::io::duplex(bytes.len().max(1) + 8);
                tokio::spawn(async move {
                    let _ = writer.write_all(&bytes).await;
                });
                Ok(ExportDownloadBody::Stream(Box::pin(reader)))
            } else {
                Ok(ExportDownloadBody::Bytes(self.get_object(key).await?))
            }
        }

        async fn put_object(
            &self,
            key: &str,
            body: Vec<u8>,
            content_type: &str,
        ) -> Result<(), ExportServiceError> {
            let mut objects = self.objects.lock().await;
            objects.insert(
                key.to_string(),
                ObjectData {
                    bytes: body,
                    content_type: content_type.to_string(),
                },
            );
            Ok(())
        }

        async fn put_file_object(
            &self,
            key: &str,
            path: &Path,
            content_type: &str,
        ) -> Result<(), ExportServiceError> {
            self.file_put_paths.lock().await.push(path.to_path_buf());
            let body = tokio::fs::read(path).await.map_err(|error| {
                ExportServiceError::internal(format!("Unable to read export file: {error}"))
            })?;
            self.put_object(key, body, content_type).await
        }
    }

    struct InspectingFfmpegRunner {
        expected_input: Vec<u8>,
        output_bytes: Vec<u8>,
    }

    #[async_trait::async_trait]
    impl crate::ffmpeg::FfmpegRunner for InspectingFfmpegRunner {
        async fn is_available(&self) -> Result<(), ExportServiceError> {
            Ok(())
        }

        async fn render(
            &self,
            input_webm: &std::path::Path,
            output_mp4: &std::path::Path,
            target: &crate::model::ExportTargetRequest,
        ) -> Result<(), ExportServiceError> {
            assert_eq!(
                tokio::fs::read(input_webm)
                    .await
                    .expect("read reconstructed input"),
                self.expected_input
            );
            assert_eq!(target.format, TARGET_FORMAT);
            assert_eq!(target.resolution, TARGET_RESOLUTION);
            tokio::fs::write(output_mp4, &self.output_bytes)
                .await
                .expect("write ffmpeg output");
            Ok(())
        }
    }

    struct BlockingFfmpegRunner {
        started: Arc<Notify>,
        release: Arc<Notify>,
        calls: Arc<AtomicUsize>,
        output_bytes: Vec<u8>,
    }

    impl BlockingFfmpegRunner {
        fn new(output_bytes: Vec<u8>) -> Self {
            Self {
                started: Arc::new(Notify::new()),
                release: Arc::new(Notify::new()),
                calls: Arc::new(AtomicUsize::new(0)),
                output_bytes,
            }
        }
    }

    #[async_trait::async_trait]
    impl crate::ffmpeg::FfmpegRunner for BlockingFfmpegRunner {
        async fn is_available(&self) -> Result<(), ExportServiceError> {
            Ok(())
        }

        async fn render(
            &self,
            _input_webm: &std::path::Path,
            output_mp4: &std::path::Path,
            _target: &crate::model::ExportTargetRequest,
        ) -> Result<(), ExportServiceError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.started.notify_waiters();
            self.release.notified().await;
            tokio::fs::write(output_mp4, &self.output_bytes)
                .await
                .expect("write blocking ffmpeg output");
            Ok(())
        }
    }

    #[tokio::test]
    async fn create_export_retries_failed_manifest() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-retry", "upload-retry");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let manifest =
            uploaded_manifest("recording-retry", "upload-retry", &chunk_bytes, true, true);
        seed_upload(&storage, &manifest, &chunk_bytes).await;

        let failed = failed_export_manifest("recording-retry", "upload-retry");
        storage
            .put_object(
                &export_manifest_key(&failed.export_id),
                serde_json::to_vec_pretty(&failed).expect("serialize failed export manifest"),
                "application/json",
            )
            .await
            .expect("seed failed manifest");

        let result = service
            .create_export(request.clone())
            .await
            .expect("failed export should retry");
        assert_eq!(result.status_code, http::StatusCode::ACCEPTED);
        assert_eq!(result.manifest.status, ExportStatus::Processing);
        assert!(result.manifest.error.is_none());

        let persisted =
            wait_for_export_status(&service, &result.manifest.export_id, ExportStatus::Ready).await;
        assert_eq!(persisted.status, ExportStatus::Ready);
        assert!(persisted.error.is_none());
    }

    #[tokio::test]
    async fn create_export_returns_existing_recent_processing_manifest() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-recent", "upload-recent");
        let existing = ExportManifest::new_processing(&request, timestamp());

        storage
            .put_object(
                &export_manifest_key(&existing.export_id),
                serde_json::to_vec_pretty(&existing).expect("serialize existing export manifest"),
                "application/json",
            )
            .await
            .expect("seed existing manifest");

        let result = service
            .create_export(request)
            .await
            .expect("recent processing manifest should be returned");
        assert_eq!(result.status_code, http::StatusCode::OK);
        assert_eq!(result.manifest.status, ExportStatus::Processing);
        assert_eq!(result.manifest.attempt_id, existing.attempt_id);
        assert_eq!(result.manifest.updated_at, existing.updated_at);
    }

    #[tokio::test]
    async fn create_export_returns_existing_processing_attempt_without_spawning_duplicate_work() {
        let storage = StorageBackend::memory().into_shared();
        let ffmpeg = Arc::new(BlockingFfmpegRunner::new(b"attempt-mp4".to_vec()));
        let service = service_with_custom_stale_after(
            storage.clone(),
            ffmpeg.clone(),
            Duration::from_secs(1800),
        );
        let request = create_request("recording-processing", "upload-processing");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let upload_manifest = uploaded_manifest(
            "recording-processing",
            "upload-processing",
            &chunk_bytes,
            true,
            true,
        );
        seed_upload(&storage, &upload_manifest, &chunk_bytes).await;

        let first_result = service
            .create_export(request.clone())
            .await
            .expect("first export attempt should start processing");
        assert_eq!(first_result.status_code, http::StatusCode::ACCEPTED);

        ffmpeg.started.notified().await;

        let second_result = service
            .create_export(request)
            .await
            .expect("second create export should reuse current processing attempt");
        assert_eq!(second_result.status_code, http::StatusCode::OK);
        assert_eq!(
            second_result.manifest.attempt_id,
            first_result.manifest.attempt_id
        );
        assert_eq!(ffmpeg.calls.load(Ordering::SeqCst), 1);

        ffmpeg.release.notify_waiters();
        let ready_manifest = wait_for_export_status(
            &service,
            &first_result.manifest.export_id,
            ExportStatus::Ready,
        )
        .await;
        assert_eq!(ready_manifest.status, ExportStatus::Ready);
    }

    #[tokio::test]
    async fn create_export_restarts_stale_processing_manifest() {
        let storage = StorageBackend::memory().into_shared();
        let ffmpeg = Arc::new(BlockingFfmpegRunner::new(b"stale-mp4".to_vec()));
        let service = service_with_custom_stale_after(
            storage.clone(),
            ffmpeg.clone(),
            Duration::from_secs(60),
        );
        let request = create_request("recording-stale", "upload-stale");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let upload_manifest =
            uploaded_manifest("recording-stale", "upload-stale", &chunk_bytes, true, true);
        seed_upload(&storage, &upload_manifest, &chunk_bytes).await;

        let stale_time = Utc::now() - TimeDelta::seconds(3600);
        let mut stale_manifest = ExportManifest::new_processing(&request, stale_time);
        stale_manifest.updated_at = stale_time;
        stale_manifest.error = Some(ExportFailure {
            code: "stale_processing".to_string(),
            message: "old worker disappeared".to_string(),
        });
        storage
            .put_object(
                &export_manifest_key(&stale_manifest.export_id),
                serde_json::to_vec_pretty(&stale_manifest).expect("serialize stale manifest"),
                "application/json",
            )
            .await
            .expect("seed stale manifest");

        let result = service
            .create_export(request)
            .await
            .expect("stale processing manifest should restart");
        assert_eq!(result.status_code, http::StatusCode::ACCEPTED);
        assert_eq!(result.manifest.status, ExportStatus::Processing);
        assert_ne!(result.manifest.attempt_id, stale_manifest.attempt_id);
        assert_ne!(
            result.manifest.output_object_key,
            stale_manifest.output_object_key
        );
        assert!(result.manifest.updated_at > stale_manifest.updated_at);
        assert!(result.manifest.error.is_none());

        ffmpeg.started.notified().await;
        ffmpeg.release.notify_waiters();
        let ready_manifest =
            wait_for_export_status(&service, &result.manifest.export_id, ExportStatus::Ready).await;
        assert_eq!(ready_manifest.output_bytes, Some(b"stale-mp4".len() as u64));
        assert_eq!(ffmpeg.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn restart_processing_assigns_new_attempt_id() {
        let request = create_request("recording-attempt", "upload-attempt");
        let original = ExportManifest::new_processing(&request, timestamp());
        let restarted = original.restart_processing(timestamp() + TimeDelta::seconds(60));

        assert_ne!(restarted.attempt_id, original.attempt_id);
        assert_ne!(restarted.output_object_key, original.output_object_key);
        assert_eq!(restarted.status, ExportStatus::Processing);
        assert!(restarted.error.is_none());
    }

    #[tokio::test]
    async fn restarted_attempt_gets_distinct_output_object_key() {
        let request = create_request("recording-output-key", "upload-output-key");
        let first_attempt = ExportManifest::new_processing(&request, timestamp());
        let restarted_attempt =
            first_attempt.restart_processing(timestamp() + TimeDelta::seconds(1));

        assert_ne!(restarted_attempt.attempt_id, first_attempt.attempt_id);
        assert_ne!(
            restarted_attempt.output_object_key,
            first_attempt.output_object_key
        );
        assert!(restarted_attempt
            .output_object_key
            .contains(&format!("/attempts/{}/", restarted_attempt.attempt_id)));
    }

    #[tokio::test]
    async fn stale_background_job_cannot_overwrite_ready_manifest() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-obsolete-ready", "upload-obsolete-ready");
        let attempt_a = ExportManifest::new_processing(&request, timestamp());
        storage
            .put_object(
                &export_manifest_key(&attempt_a.export_id),
                serde_json::to_vec_pretty(&attempt_a).expect("serialize attempt a"),
                "application/json",
            )
            .await
            .expect("store attempt a");

        let attempt_b = attempt_a.restart_processing(timestamp() + TimeDelta::seconds(5));
        service
            .store_export_manifest(&export_manifest_key(&attempt_b.export_id), &attempt_b)
            .await
            .expect("store attempt b");

        let mut ready_b = attempt_b.clone();
        ready_b.status = ExportStatus::Ready;
        ready_b.output_bytes = Some(42);
        ready_b.completed_at = Some(timestamp() + TimeDelta::seconds(10));
        ready_b.updated_at = timestamp() + TimeDelta::seconds(10);
        let persisted_ready = service
            .store_terminal_manifest_if_current_attempt(&ready_b)
            .await
            .expect("persist ready manifest");
        assert_eq!(persisted_ready.status, ExportStatus::Ready);

        service
            .mark_export_failed(
                &attempt_a,
                &ExportServiceError::processing("ffmpeg_failed", "stale attempt failed"),
            )
            .await
            .expect("obsolete failure should not overwrite ready export");

        let final_manifest = service
            .get_export(&attempt_a.export_id)
            .await
            .expect("final manifest");
        assert_eq!(final_manifest.status, ExportStatus::Ready);
        assert_eq!(final_manifest.attempt_id, attempt_b.attempt_id);
        assert_eq!(final_manifest.output_bytes, Some(42));
    }

    #[tokio::test]
    async fn stale_attempt_cannot_overwrite_newer_attempt_output_object() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-output-race", "upload-output-race");
        let attempt_a = ExportManifest::new_processing(&request, timestamp());
        storage
            .put_object(
                &export_manifest_key(&attempt_a.export_id),
                serde_json::to_vec_pretty(&attempt_a).expect("serialize attempt a"),
                "application/json",
            )
            .await
            .expect("store attempt a");

        let attempt_b = attempt_a.restart_processing(timestamp() + TimeDelta::seconds(5));
        service
            .store_export_manifest(&export_manifest_key(&attempt_b.export_id), &attempt_b)
            .await
            .expect("store attempt b");

        storage
            .put_object(
                &attempt_b.output_object_key,
                b"newer-attempt-mp4".to_vec(),
                "video/mp4",
            )
            .await
            .expect("store newer attempt output");
        let mut ready_b = attempt_b.clone();
        ready_b.status = ExportStatus::Ready;
        ready_b.output_bytes = Some(b"newer-attempt-mp4".len() as u64);
        ready_b.completed_at = Some(timestamp() + TimeDelta::seconds(6));
        ready_b.updated_at = timestamp() + TimeDelta::seconds(6);
        service
            .store_terminal_manifest_if_current_attempt(&ready_b)
            .await
            .expect("persist ready attempt b");

        storage
            .put_object(
                &attempt_a.output_object_key,
                b"stale-attempt-mp4".to_vec(),
                "video/mp4",
            )
            .await
            .expect("store stale attempt output");
        service
            .mark_export_failed(
                &attempt_a,
                &ExportServiceError::processing("ffmpeg_failed", "stale attempt failed"),
            )
            .await
            .expect("obsolete failure should not overwrite manifest");

        let final_manifest = service
            .get_export(&attempt_a.export_id)
            .await
            .expect("final manifest");
        assert_eq!(final_manifest.status, ExportStatus::Ready);
        assert_eq!(final_manifest.attempt_id, attempt_b.attempt_id);
        assert_eq!(
            final_manifest.output_object_key,
            attempt_b.output_object_key
        );

        let newer_output = storage
            .get_object(&attempt_b.output_object_key)
            .await
            .expect("newer output should exist");
        let stale_output = storage
            .get_object(&attempt_a.output_object_key)
            .await
            .expect("stale output should exist");
        assert_eq!(newer_output, b"newer-attempt-mp4".to_vec());
        assert_eq!(stale_output, b"stale-attempt-mp4".to_vec());
    }

    #[tokio::test]
    async fn obsolete_attempt_validation_failure_cannot_overwrite_ready_manifest() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request(
            "recording-obsolete-validation",
            "upload-obsolete-validation",
        );
        let attempt_a = ExportManifest::new_processing(&request, timestamp());
        let attempt_b = attempt_a.restart_processing(timestamp() + TimeDelta::seconds(5));

        service
            .store_export_manifest(&export_manifest_key(&attempt_b.export_id), &attempt_b)
            .await
            .expect("store attempt b");

        let mut ready_b = attempt_b.clone();
        ready_b.status = ExportStatus::Ready;
        ready_b.output_bytes = Some(10);
        ready_b.completed_at = Some(timestamp() + TimeDelta::seconds(6));
        ready_b.updated_at = timestamp() + TimeDelta::seconds(6);
        storage
            .put_object(
                &ready_b.output_object_key,
                b"ready-bytes".to_vec(),
                "video/mp4",
            )
            .await
            .expect("store ready bytes");
        service
            .store_terminal_manifest_if_current_attempt(&ready_b)
            .await
            .expect("persist ready attempt");

        let invalid_source = UploadManifest {
            uploaded_bytes: 1,
            total_bytes: 2,
            ..uploaded_manifest(
                "recording-obsolete-validation",
                "upload-obsolete-validation",
                &[b"chunk-a".to_vec()],
                true,
                true,
            )
        };

        let error = service
            .validate_upload_manifest(&invalid_source, &request, &attempt_a)
            .await
            .expect_err("validation should fail");
        assert_eq!(error.code(), "incomplete_upload");

        let final_manifest = service
            .get_export(&attempt_a.export_id)
            .await
            .expect("final manifest");
        assert_eq!(final_manifest.status, ExportStatus::Ready);
        assert_eq!(final_manifest.attempt_id, attempt_b.attempt_id);
        assert_eq!(
            final_manifest.output_object_key,
            attempt_b.output_object_key
        );
    }

    #[tokio::test]
    async fn obsolete_attempt_checksum_failure_cannot_overwrite_ready_manifest() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-obsolete-checksum", "upload-obsolete-checksum");
        let chunk_bytes = vec![b"chunk-a".to_vec()];
        let source_manifest = uploaded_manifest(
            "recording-obsolete-checksum",
            "upload-obsolete-checksum",
            &chunk_bytes,
            true,
            false,
        );
        seed_upload(&storage, &source_manifest, &chunk_bytes).await;

        let attempt_a = ExportManifest::new_processing(&request, timestamp());
        let attempt_b = attempt_a.restart_processing(timestamp() + TimeDelta::seconds(5));
        service
            .store_export_manifest(&export_manifest_key(&attempt_b.export_id), &attempt_b)
            .await
            .expect("store attempt b");

        let mut ready_b = attempt_b.clone();
        ready_b.status = ExportStatus::Ready;
        ready_b.output_bytes = Some(10);
        ready_b.completed_at = Some(timestamp() + TimeDelta::seconds(6));
        ready_b.updated_at = timestamp() + TimeDelta::seconds(6);
        storage
            .put_object(
                &ready_b.output_object_key,
                b"ready-bytes".to_vec(),
                "video/mp4",
            )
            .await
            .expect("store ready bytes");
        service
            .store_terminal_manifest_if_current_attempt(&ready_b)
            .await
            .expect("persist ready attempt");

        let temp_dir = tempfile::tempdir().expect("temp dir");
        let input_path = temp_dir.path().join("source.webm");
        let chunks = source_manifest.chunks.clone();

        let error = service
            .rebuild_webm(&source_manifest, &chunks, &attempt_a, &input_path)
            .await
            .expect_err("checksum mismatch should fail");
        assert_eq!(error.code(), "checksum_mismatch");

        let final_manifest = service
            .get_export(&attempt_a.export_id)
            .await
            .expect("final manifest");
        assert_eq!(final_manifest.status, ExportStatus::Ready);
        assert_eq!(final_manifest.attempt_id, attempt_b.attempt_id);
        assert_eq!(
            final_manifest.output_object_key,
            attempt_b.output_object_key
        );
    }

    #[tokio::test]
    async fn obsolete_attempt_missing_chunk_failure_cannot_overwrite_ready_manifest() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-obsolete-missing", "upload-obsolete-missing");
        let attempt_a = ExportManifest::new_processing(&request, timestamp());
        let attempt_b = attempt_a.restart_processing(timestamp() + TimeDelta::seconds(5));

        service
            .store_export_manifest(&export_manifest_key(&attempt_b.export_id), &attempt_b)
            .await
            .expect("store attempt b");

        let mut ready_b = attempt_b.clone();
        ready_b.status = ExportStatus::Ready;
        ready_b.output_bytes = Some(10);
        ready_b.completed_at = Some(timestamp() + TimeDelta::seconds(6));
        ready_b.updated_at = timestamp() + TimeDelta::seconds(6);
        storage
            .put_object(
                &ready_b.output_object_key,
                b"ready-bytes".to_vec(),
                "video/mp4",
            )
            .await
            .expect("store ready bytes");
        service
            .store_terminal_manifest_if_current_attempt(&ready_b)
            .await
            .expect("persist ready attempt");

        let mut missing_chunk_source = uploaded_manifest(
            "recording-obsolete-missing",
            "upload-obsolete-missing",
            &[b"chunk-a".to_vec(), b"chunk-b".to_vec()],
            true,
            true,
        );
        missing_chunk_source.chunks.pop();
        missing_chunk_source.uploaded_chunk_count = 1;

        let error = service
            .validate_upload_manifest(&missing_chunk_source, &request, &attempt_a)
            .await
            .expect_err("missing chunk should fail");
        assert_eq!(error.code(), "incomplete_upload");

        let final_manifest = service
            .get_export(&attempt_a.export_id)
            .await
            .expect("final manifest");
        assert_eq!(final_manifest.status, ExportStatus::Ready);
        assert_eq!(final_manifest.attempt_id, attempt_b.attempt_id);
        assert_eq!(
            final_manifest.output_object_key,
            attempt_b.output_object_key
        );
    }

    #[tokio::test]
    async fn stale_background_job_cannot_overwrite_failed_manifest_from_newer_attempt() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-obsolete-failed", "upload-obsolete-failed");
        let attempt_a = ExportManifest::new_processing(&request, timestamp());
        storage
            .put_object(
                &export_manifest_key(&attempt_a.export_id),
                serde_json::to_vec_pretty(&attempt_a).expect("serialize attempt a"),
                "application/json",
            )
            .await
            .expect("store attempt a");

        let attempt_b = attempt_a.restart_processing(timestamp() + TimeDelta::seconds(5));
        service
            .store_export_manifest(&export_manifest_key(&attempt_b.export_id), &attempt_b)
            .await
            .expect("store attempt b");
        service
            .mark_export_failed(
                &attempt_b,
                &ExportServiceError::processing("ffmpeg_timeout", "newer attempt timed out"),
            )
            .await
            .expect("current failure should persist");

        let mut stale_ready_a = attempt_a.clone();
        stale_ready_a.status = ExportStatus::Ready;
        stale_ready_a.output_bytes = Some(24);
        stale_ready_a.completed_at = Some(timestamp() + TimeDelta::seconds(10));
        stale_ready_a.updated_at = timestamp() + TimeDelta::seconds(10);
        let returned_manifest = service
            .store_terminal_manifest_if_current_attempt(&stale_ready_a)
            .await
            .expect("obsolete ready should be ignored");
        assert_eq!(returned_manifest.status, ExportStatus::Failed);

        let final_manifest = service
            .get_export(&attempt_a.export_id)
            .await
            .expect("final manifest");
        assert_eq!(final_manifest.status, ExportStatus::Failed);
        assert_eq!(final_manifest.attempt_id, attempt_b.attempt_id);
        assert_eq!(
            final_manifest
                .error
                .as_ref()
                .map(|error| error.code.as_str()),
            Some("ffmpeg_timeout")
        );
    }

    #[tokio::test]
    async fn create_export_sorts_manifest_chunks_numerically() {
        let storage = Arc::new(RecordingStorage::new(false, Vec::new()));
        let ffmpeg = Arc::new(InspectingFfmpegRunner {
            expected_input: b"chunk-bchunk-a".to_vec(),
            output_bytes: b"encoded-mp4".to_vec(),
        });
        let (service, storage) = service_with_custom_storage(storage, ffmpeg);
        let request = create_request("recording-sort", "upload-sort");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let manifest =
            uploaded_manifest("recording-sort", "upload-sort", &chunk_bytes, false, true);
        let storage_trait: Arc<dyn ExportStorage> = storage.clone();
        seed_upload(&storage_trait, &manifest, &chunk_bytes).await;

        let result = service
            .create_export(request.clone())
            .await
            .expect("export should complete");
        assert_eq!(result.status_code, http::StatusCode::ACCEPTED);
        assert_eq!(result.manifest.status, ExportStatus::Processing);
        let created_manifest =
            wait_for_export_status(&service, &result.manifest.export_id, ExportStatus::Ready).await;
        assert_eq!(
            created_manifest.output_bytes,
            Some(b"encoded-mp4".len() as u64)
        );
    }

    #[tokio::test]
    async fn create_export_rejects_duplicate_chunk_indexes() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-dup", "upload-dup");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let mut manifest =
            uploaded_manifest("recording-dup", "upload-dup", &chunk_bytes, true, true);
        manifest.chunks[1].chunk_index = 0;
        seed_upload(&storage, &manifest, &chunk_bytes).await;

        let result = service
            .create_export(request.clone())
            .await
            .expect("create export should return processing");
        assert_eq!(result.status_code, http::StatusCode::ACCEPTED);

        let persisted = wait_for_export_status(
            &service,
            &export_id_for_recording(&request.recording_id),
            ExportStatus::Failed,
        )
        .await;
        assert_eq!(
            persisted.error.as_ref().map(|error| error.code.as_str()),
            Some("duplicate_chunk_indexes")
        );
    }

    #[tokio::test]
    async fn create_export_rejects_failed_chunk_status() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-failed-chunk", "upload-failed-chunk");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let mut manifest = uploaded_manifest(
            "recording-failed-chunk",
            "upload-failed-chunk",
            &chunk_bytes,
            true,
            true,
        );
        manifest.chunks[1].status = UploadChunkStatus::Failed;
        seed_upload(&storage, &manifest, &chunk_bytes).await;

        let result = service
            .create_export(request.clone())
            .await
            .expect("create export should return processing");
        assert_eq!(result.status_code, http::StatusCode::ACCEPTED);

        let persisted = wait_for_export_status(
            &service,
            &export_id_for_recording(&request.recording_id),
            ExportStatus::Failed,
        )
        .await;
        assert_eq!(
            persisted.error.as_ref().map(|error| error.code.as_str()),
            Some("failed_chunk_status")
        );
    }

    #[tokio::test]
    async fn create_export_rejects_chunk_byte_mismatch() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-byte", "upload-byte");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let mut manifest =
            uploaded_manifest("recording-byte", "upload-byte", &chunk_bytes, true, true);
        manifest.chunks[1].uploaded_bytes = manifest.chunks[1].uploaded_bytes.saturating_sub(1);
        seed_upload(&storage, &manifest, &chunk_bytes).await;

        let result = service
            .create_export(request.clone())
            .await
            .expect("create export should return processing");
        assert_eq!(result.status_code, http::StatusCode::ACCEPTED);

        let persisted = wait_for_export_status(
            &service,
            &export_id_for_recording(&request.recording_id),
            ExportStatus::Failed,
        )
        .await;
        assert_eq!(
            persisted.error.as_ref().map(|error| error.code.as_str()),
            Some("chunk_byte_mismatch")
        );
    }

    #[tokio::test]
    async fn create_export_uses_file_path_for_output_mp4() {
        let storage = Arc::new(RecordingStorage::new(false, Vec::new()));
        let ffmpeg = Arc::new(InspectingFfmpegRunner {
            expected_input: b"chunk-achunk-b".to_vec(),
            output_bytes: b"path-output".to_vec(),
        });
        let (service, storage) = service_with_custom_storage(storage, ffmpeg);
        let request = create_request("recording-path", "upload-path");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let manifest = uploaded_manifest("recording-path", "upload-path", &chunk_bytes, true, true);
        let storage_trait: Arc<dyn ExportStorage> = storage.clone();
        seed_upload(&storage_trait, &manifest, &chunk_bytes).await;

        let result = service
            .create_export(request.clone())
            .await
            .expect("export should complete");
        assert_eq!(result.status_code, http::StatusCode::ACCEPTED);

        wait_for_export_status(&service, &result.manifest.export_id, ExportStatus::Ready).await;

        let file_put_paths = storage.file_put_paths().await;
        assert_eq!(file_put_paths.len(), 1);
        assert_eq!(
            file_put_paths
                .first()
                .and_then(|path| path.file_name())
                .and_then(|name| name.to_str()),
            Some("final.mp4")
        );
    }

    #[tokio::test]
    async fn download_export_returns_stream_body_when_storage_streams() {
        let storage = Arc::new(RecordingStorage::new(true, b"streamed-mp4".to_vec()));
        let ffmpeg = Arc::new(FakeFfmpegRunner::available());
        let service = ExportService::new(storage.clone(), ffmpeg);
        let export_id = export_id_for_recording("recording-stream");
        let manifest = ExportManifest {
            manifest_version: 1,
            export_id: export_id.clone(),
            attempt_id: "attempt_stream".to_string(),
            recording_id: "recording-stream".to_string(),
            upload_id: "upload-stream".to_string(),
            session_id: "session-1".to_string(),
            participant_id: "participant-1".to_string(),
            role: crate::model::ParticipantRole::Host,
            status: ExportStatus::Ready,
            target_format: TARGET_FORMAT.to_string(),
            target_resolution: TARGET_RESOLUTION.to_string(),
            source_manifest_key: upload_manifest_key("recording-stream", "upload-stream"),
            output_object_key: crate::model::export_output_key(
                "session-1",
                "participant-1",
                "recording-stream",
                &export_id,
                "attempt_stream",
            ),
            output_bytes: Some(b"streamed-mp4".len() as u64),
            created_at: timestamp(),
            updated_at: timestamp(),
            completed_at: Some(timestamp()),
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

        let download = service
            .download_export(&export_id)
            .await
            .expect("download export");
        assert_eq!(download.content_length, Some(b"streamed-mp4".len() as u64));
        assert!(matches!(download.body, ExportDownloadBody::Stream(_)));
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

        let result = service
            .create_export(request.clone())
            .await
            .expect("create export should return processing");
        assert_eq!(result.status_code, http::StatusCode::ACCEPTED);

        let export_id = export_id_for_recording(&request.recording_id);
        let manifest = wait_for_export_status(&service, &export_id, ExportStatus::Failed).await;
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

        let result = service
            .create_export(request.clone())
            .await
            .expect("create export should return processing");
        assert_eq!(result.status_code, http::StatusCode::ACCEPTED);

        let export_id = export_id_for_recording(&request.recording_id);
        let persisted = wait_for_export_status(&service, &export_id, ExportStatus::Failed).await;
        assert_eq!(persisted.status, ExportStatus::Failed);
        assert_eq!(
            persisted.error.as_ref().map(|error| error.code.as_str()),
            Some("upload_incomplete")
        );
    }

    #[tokio::test]
    async fn create_export_accepts_chunks_out_of_order() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-3", "upload-3");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let manifest = uploaded_manifest("recording-3", "upload-3", &chunk_bytes, false, true);
        seed_upload(&storage, &manifest, &chunk_bytes).await;

        let result = service
            .create_export(request.clone())
            .await
            .expect("export should complete");
        assert_eq!(result.status_code, http::StatusCode::ACCEPTED);
        let created_manifest =
            wait_for_export_status(&service, &result.manifest.export_id, ExportStatus::Ready).await;
        assert_eq!(created_manifest.status, ExportStatus::Ready);
    }

    #[tokio::test]
    async fn create_export_fails_when_checksums_do_not_match() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-4", "upload-4");
        let chunk_bytes = vec![b"chunk-a".to_vec(), b"chunk-b".to_vec()];
        let manifest = uploaded_manifest("recording-4", "upload-4", &chunk_bytes, true, false);
        seed_upload(&storage, &manifest, &chunk_bytes).await;

        let result = service
            .create_export(request.clone())
            .await
            .expect("create export should return processing");
        assert_eq!(result.status_code, http::StatusCode::ACCEPTED);

        let export_id = export_id_for_recording(&request.recording_id);
        let persisted = wait_for_export_status(&service, &export_id, ExportStatus::Failed).await;
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

        let result = service
            .create_export(request.clone())
            .await
            .expect("export should complete");
        assert_eq!(result.status_code, http::StatusCode::ACCEPTED);
        let created_manifest =
            wait_for_export_status(&service, &result.manifest.export_id, ExportStatus::Ready).await;
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
        assert_eq!(output.content_length, Some(b"fake-mp4".len() as u64));
        match output.body {
            ExportDownloadBody::Bytes(bytes) => assert_eq!(bytes, b"fake-mp4".to_vec()),
            ExportDownloadBody::Stream(_) => panic!("expected in-memory bytes"),
        }
    }

    #[tokio::test]
    async fn ready_manifest_download_uses_current_attempt_output_key() {
        let (service, storage) = service_with_memory_storage();
        let request = create_request("recording-download-key", "upload-download-key");
        let attempt_a = ExportManifest::new_processing(&request, timestamp());
        let attempt_b = attempt_a.restart_processing(timestamp() + TimeDelta::seconds(5));

        storage
            .put_object(
                &attempt_a.output_object_key,
                b"stale-attempt-bytes".to_vec(),
                "video/mp4",
            )
            .await
            .expect("store stale bytes");
        storage
            .put_object(
                &attempt_b.output_object_key,
                b"current-attempt-bytes".to_vec(),
                "video/mp4",
            )
            .await
            .expect("store current bytes");

        let mut ready_manifest = attempt_b.clone();
        ready_manifest.status = ExportStatus::Ready;
        ready_manifest.output_bytes = Some(b"current-attempt-bytes".len() as u64);
        ready_manifest.completed_at = Some(timestamp() + TimeDelta::seconds(6));
        ready_manifest.updated_at = timestamp() + TimeDelta::seconds(6);

        storage
            .put_object(
                &export_manifest_key(&ready_manifest.export_id),
                serde_json::to_vec_pretty(&ready_manifest).expect("serialize ready manifest"),
                "application/json",
            )
            .await
            .expect("store ready manifest");

        let output = service
            .download_export(&ready_manifest.export_id)
            .await
            .expect("download current attempt output");
        match output.body {
            ExportDownloadBody::Bytes(bytes) => {
                assert_eq!(bytes, b"current-attempt-bytes".to_vec())
            }
            ExportDownloadBody::Stream(_) => panic!("expected in-memory bytes"),
        }
    }

    #[tokio::test]
    async fn download_export_rejects_unfinished_exports() {
        let (service, storage) = service_with_memory_storage();
        let export_id = export_id_for_recording("recording-6");
        let manifest = ExportManifest {
            manifest_version: 1,
            export_id: export_id.clone(),
            attempt_id: "attempt_processing".to_string(),
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
                "attempt_processing",
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
