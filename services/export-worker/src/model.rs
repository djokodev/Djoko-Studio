use std::sync::atomic::{AtomicU64, Ordering};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const EXPORT_MANIFEST_VERSION: u32 = 1;
pub const TARGET_FORMAT: &str = "mp4";
pub const TARGET_RESOLUTION: &str = "1920x1080";
pub const TARGET_DISPLAY_LABEL: &str = "MP4 1080p";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportStatus {
    Pending,
    Processing,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantRole {
    Host,
    Guest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadStatus {
    Initializing,
    Ready,
    Uploading,
    Paused,
    Incomplete,
    Uploaded,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadChunkStatus {
    Pending,
    Uploaded,
    AlreadyPresent,
    Failed,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportTargetRequest {
    pub format: String,
    pub resolution: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateExportRequest {
    pub recording_id: String,
    pub upload_id: String,
    pub session_id: String,
    pub participant_id: String,
    pub role: ParticipantRole,
    pub target: ExportTargetRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportFailure {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportManifest {
    pub manifest_version: u32,
    pub export_id: String,
    pub attempt_id: String,
    pub recording_id: String,
    pub upload_id: String,
    pub session_id: String,
    pub participant_id: String,
    pub role: ParticipantRole,
    pub status: ExportStatus,
    pub target_format: String,
    pub target_resolution: String,
    pub source_manifest_key: String,
    pub output_object_key: String,
    pub output_bytes: Option<u64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error: Option<ExportFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportReadyzResponse {
    pub status: String,
    pub service: String,
    pub storage: String,
    pub ffmpeg: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDetails {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEnvelope {
    pub error: ErrorDetails,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UploadChunkManifest {
    pub chunk_index: u32,
    pub expected_bytes: u64,
    pub uploaded_bytes: u64,
    pub status: UploadChunkStatus,
    pub checksum: Option<String>,
    pub updated_at: DateTime<Utc>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UploadManifest {
    pub manifest_version: u32,
    pub recording_id: String,
    pub session_id: String,
    pub participant_id: String,
    pub role: ParticipantRole,
    pub upload_id: String,
    pub status: UploadStatus,
    pub mime_type: Option<String>,
    pub expected_chunk_count: u32,
    pub chunk_size_bytes: u64,
    pub total_bytes: u64,
    pub uploaded_bytes: u64,
    pub uploaded_chunk_count: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub chunks: Vec<UploadChunkManifest>,
}

impl ExportManifest {
    pub fn new_processing(request: &CreateExportRequest, now: DateTime<Utc>) -> Self {
        let export_id = export_id_for_recording(&request.recording_id);
        let source_manifest_key = upload_manifest_key(&request.recording_id, &request.upload_id);
        let output_object_key = export_output_key(
            &request.session_id,
            &request.participant_id,
            &request.recording_id,
            &export_id,
        );

        Self {
            manifest_version: EXPORT_MANIFEST_VERSION,
            export_id,
            attempt_id: next_attempt_id(),
            recording_id: request.recording_id.trim().to_string(),
            upload_id: request.upload_id.trim().to_string(),
            session_id: request.session_id.trim().to_string(),
            participant_id: request.participant_id.trim().to_string(),
            role: request.role,
            status: ExportStatus::Processing,
            target_format: request.target.format.trim().to_string(),
            target_resolution: request.target.resolution.trim().to_string(),
            source_manifest_key,
            output_object_key,
            output_bytes: None,
            created_at: now,
            updated_at: now,
            completed_at: None,
            error: None,
        }
    }

    pub fn restart_processing(&self, now: DateTime<Utc>) -> Self {
        let mut manifest = self.clone();
        manifest.attempt_id = next_attempt_id();
        manifest.status = ExportStatus::Processing;
        manifest.updated_at = now;
        manifest.completed_at = None;
        manifest.output_bytes = None;
        manifest.error = None;
        manifest
    }

    pub fn is_completed(&self) -> bool {
        matches!(self.status, ExportStatus::Ready)
    }
}

pub fn export_id_for_recording(recording_id: &str) -> String {
    format!("exp-{recording_id}")
}

pub fn export_manifest_key(export_id: &str) -> String {
    format!("exports/{export_id}/manifest.json")
}

pub fn export_output_key(
    session_id: &str,
    participant_id: &str,
    recording_id: &str,
    export_id: &str,
) -> String {
    format!(
        "sessions/{session_id}/participants/{participant_id}/recordings/{recording_id}/exports/{export_id}/output-1080p.mp4"
    )
}

pub fn export_download_filename(export_id: &str) -> String {
    format!("{export_id}-1080p.mp4")
}

pub fn upload_manifest_key(recording_id: &str, upload_id: &str) -> String {
    format!("recordings/{recording_id}/uploads/{upload_id}/manifest.json")
}

fn next_attempt_id() -> String {
    static ATTEMPT_COUNTER: AtomicU64 = AtomicU64::new(1);

    let counter = ATTEMPT_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("attempt_{}_{}", Utc::now().timestamp_millis(), counter)
}
