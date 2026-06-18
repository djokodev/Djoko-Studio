use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub const MANIFEST_VERSION: u32 = 1;
pub const DEFAULT_SESSION_TTL_HOURS: i64 = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ParticipantRole {
    Host,
    Guest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadSessionStatus {
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
pub struct CreateUploadSessionRequest {
    pub recording_id: String,
    pub session_id: String,
    pub participant_id: String,
    pub role: ParticipantRole,
    pub total_bytes: u64,
    pub expected_chunk_count: u32,
    pub chunk_size_bytes: u64,
    pub mime_type: Option<String>,
    pub manifest_version: u32,
    pub client_created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateUploadSessionResponse {
    pub recording_id: String,
    pub session_id: String,
    pub participant_id: String,
    pub role: ParticipantRole,
    pub upload_id: String,
    pub status: UploadSessionStatus,
    pub accepted_chunk_size_bytes: u64,
    pub expected_chunk_count: u32,
    pub uploaded_chunk_count: u32,
    pub total_bytes: u64,
    pub uploaded_bytes: u64,
    pub missing_chunk_indexes: Vec<u32>,
    pub rejected_chunk_indexes: Vec<u32>,
    pub updated_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GetUploadSessionStatusResponse {
    pub recording_id: String,
    pub session_id: String,
    pub participant_id: String,
    pub role: ParticipantRole,
    pub upload_id: String,
    pub status: UploadSessionStatus,
    pub expected_chunk_count: u32,
    pub uploaded_chunk_count: u32,
    pub total_bytes: u64,
    pub uploaded_bytes: u64,
    pub missing_chunk_indexes: Vec<u32>,
    pub rejected_chunk_indexes: Vec<u32>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct UploadChunkRequest {
    pub recording_id: String,
    pub upload_id: String,
    pub chunk_index: u32,
    pub chunk_size_bytes: u64,
    pub total_bytes: u64,
    pub mime_type: String,
    pub idempotency_key: String,
    pub body: Vec<u8>,
    pub chunk_checksum: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UploadChunkResponse {
    pub recording_id: String,
    pub upload_id: String,
    pub chunk_index: u32,
    pub status: UploadChunkStatus,
    /// Size of the accepted chunk in bytes, not the total upload session bytes.
    pub uploaded_bytes: u64,
    pub already_present: bool,
    pub uploaded_chunk_count: u32,
    pub missing_chunk_indexes: Vec<u32>,
    pub rejected_chunk_indexes: Vec<u32>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CompleteUploadSessionResponse {
    pub recording_id: String,
    pub session_id: String,
    pub participant_id: String,
    pub role: ParticipantRole,
    pub upload_id: String,
    pub status: UploadSessionStatus,
    pub complete: bool,
    pub missing_chunk_indexes: Vec<u32>,
    pub rejected_chunk_indexes: Vec<u32>,
    pub uploaded_chunk_count: u32,
    pub uploaded_bytes: u64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CancelUploadSessionResponse {
    pub recording_id: String,
    pub session_id: String,
    pub participant_id: String,
    pub role: ParticipantRole,
    pub upload_id: String,
    pub status: UploadSessionStatus,
    pub complete: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UploadChunkRecord {
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
pub struct UploadSessionRecord {
    pub manifest_version: u32,
    pub recording_id: String,
    pub session_id: String,
    pub participant_id: String,
    pub role: ParticipantRole,
    pub upload_id: String,
    pub status: UploadSessionStatus,
    pub mime_type: Option<String>,
    pub expected_chunk_count: u32,
    pub chunk_size_bytes: u64,
    pub total_bytes: u64,
    pub uploaded_bytes: u64,
    pub uploaded_chunk_count: u32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub expires_at: DateTime<Utc>,
    pub last_error: Option<String>,
    pub chunks: Vec<UploadChunkRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadSessionKey {
    pub recording_id: String,
    pub session_id: String,
    pub participant_id: String,
    pub upload_id: String,
}

impl UploadSessionKey {
    pub fn manifest_key(&self) -> String {
        format!(
            "recordings/{}/uploads/{}/manifest.json",
            self.recording_id, self.upload_id
        )
    }

    pub fn chunk_key(&self, chunk_index: u32) -> String {
        format!(
            "sessions/{}/participants/{}/recordings/{}/uploads/{}/chunks/{chunk_index}",
            self.session_id, self.participant_id, self.recording_id, self.upload_id
        )
    }
}

impl UploadSessionRecord {
    pub fn new(
        request: &CreateUploadSessionRequest,
        upload_id: String,
        now: DateTime<Utc>,
    ) -> Self {
        let expires_at = now + Duration::hours(DEFAULT_SESSION_TTL_HOURS);
        let chunks = (0..request.expected_chunk_count)
            .map(|chunk_index| UploadChunkRecord {
                chunk_index,
                expected_bytes: 0,
                uploaded_bytes: 0,
                status: UploadChunkStatus::Pending,
                checksum: None,
                updated_at: now,
                error_message: None,
            })
            .collect();

        Self {
            manifest_version: request.manifest_version,
            recording_id: request.recording_id.trim().to_string(),
            session_id: request.session_id.trim().to_string(),
            participant_id: request.participant_id.trim().to_string(),
            role: request.role,
            upload_id,
            status: UploadSessionStatus::Ready,
            mime_type: request
                .mime_type
                .as_ref()
                .map(|value| value.trim().to_string()),
            expected_chunk_count: request.expected_chunk_count,
            chunk_size_bytes: request.chunk_size_bytes,
            total_bytes: request.total_bytes,
            uploaded_bytes: 0,
            uploaded_chunk_count: 0,
            created_at: now,
            updated_at: now,
            completed_at: None,
            expires_at,
            last_error: None,
            chunks,
        }
    }

    pub fn key(&self) -> UploadSessionKey {
        UploadSessionKey {
            recording_id: self.recording_id.clone(),
            session_id: self.session_id.clone(),
            participant_id: self.participant_id.clone(),
            upload_id: self.upload_id.clone(),
        }
    }

    pub fn missing_chunk_indexes(&self) -> Vec<u32> {
        self.chunks
            .iter()
            .filter(|chunk| {
                !matches!(
                    chunk.status,
                    UploadChunkStatus::Uploaded | UploadChunkStatus::AlreadyPresent
                )
            })
            .map(|chunk| chunk.chunk_index)
            .collect()
    }

    pub fn rejected_chunk_indexes(&self) -> Vec<u32> {
        self.chunks
            .iter()
            .filter(|chunk| chunk.status == UploadChunkStatus::Rejected)
            .map(|chunk| chunk.chunk_index)
            .collect()
    }

    pub fn uploaded_bytes_total(&self) -> u64 {
        self.chunks
            .iter()
            .filter(|chunk| {
                matches!(
                    chunk.status,
                    UploadChunkStatus::Uploaded | UploadChunkStatus::AlreadyPresent
                )
            })
            .map(|chunk| chunk.uploaded_bytes)
            .sum()
    }

    pub fn uploaded_chunk_count_total(&self) -> u32 {
        self.chunks
            .iter()
            .filter(|chunk| {
                matches!(
                    chunk.status,
                    UploadChunkStatus::Uploaded | UploadChunkStatus::AlreadyPresent
                )
            })
            .count() as u32
    }

    pub fn apply_chunk(
        &mut self,
        chunk_index: u32,
        uploaded_bytes: u64,
        checksum: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<UploadChunkResponse, UploadServiceError> {
        let chunk = self.chunks.get_mut(chunk_index as usize).ok_or_else(|| {
            UploadServiceError::validation(
                "invalid_chunk_index",
                "Chunk index is outside the expected range.",
                false,
            )
        })?;

        if uploaded_bytes == 0 {
            return Err(UploadServiceError::validation(
                "chunk_size_mismatch",
                "Chunk size must be greater than zero.",
                false,
            ));
        }

        if let Some(existing_checksum) = &chunk.checksum {
            if let Some(incoming_checksum) = &checksum {
                if existing_checksum != incoming_checksum {
                    chunk.status = UploadChunkStatus::Rejected;
                    chunk.error_message = Some("Chunk checksum mismatch.".to_string());
                    chunk.updated_at = now;
                    self.status = UploadSessionStatus::Incomplete;
                    self.updated_at = now;
                    self.last_error = chunk.error_message.clone();
                    return Ok(self.chunk_response(
                        chunk_index,
                        UploadChunkStatus::Rejected,
                        uploaded_bytes,
                        false,
                        now,
                    ));
                }
            }
        }

        let already_present = matches!(
            chunk.status,
            UploadChunkStatus::Uploaded | UploadChunkStatus::AlreadyPresent
        ) && chunk.uploaded_bytes == uploaded_bytes
            && (checksum.is_none() || chunk.checksum == checksum);

        if already_present {
            chunk.status = UploadChunkStatus::AlreadyPresent;
            chunk.updated_at = now;
            self.status = UploadSessionStatus::Uploading;
            self.updated_at = now;
            self.uploaded_bytes = self.uploaded_bytes_total();
            self.uploaded_chunk_count = self.uploaded_chunk_count_total();
            return Ok(self.chunk_response(
                chunk_index,
                UploadChunkStatus::AlreadyPresent,
                uploaded_bytes,
                true,
                now,
            ));
        }

        chunk.status = UploadChunkStatus::Uploaded;
        chunk.uploaded_bytes = uploaded_bytes;
        chunk.expected_bytes = chunk.expected_bytes.max(uploaded_bytes);
        chunk.checksum = checksum;
        chunk.error_message = None;
        chunk.updated_at = now;

        self.status = UploadSessionStatus::Uploading;
        self.updated_at = now;
        self.last_error = None;
        self.uploaded_bytes = self.uploaded_bytes_total();
        self.uploaded_chunk_count = self.uploaded_chunk_count_total();

        Ok(self.chunk_response(
            chunk_index,
            UploadChunkStatus::Uploaded,
            uploaded_bytes,
            false,
            now,
        ))
    }

    pub fn complete(&mut self, now: DateTime<Utc>) -> CompleteUploadSessionResponse {
        let missing = self.missing_chunk_indexes();
        let rejected = self.rejected_chunk_indexes();
        let complete =
            missing.is_empty() && rejected.is_empty() && self.uploaded_bytes == self.total_bytes;

        self.updated_at = now;
        self.completed_at = if complete { Some(now) } else { None };
        self.status = if complete {
            UploadSessionStatus::Uploaded
        } else {
            UploadSessionStatus::Incomplete
        };

        CompleteUploadSessionResponse {
            recording_id: self.recording_id.clone(),
            session_id: self.session_id.clone(),
            participant_id: self.participant_id.clone(),
            role: self.role,
            upload_id: self.upload_id.clone(),
            status: self.status,
            complete,
            missing_chunk_indexes: missing,
            rejected_chunk_indexes: rejected,
            uploaded_chunk_count: self.uploaded_chunk_count_total(),
            uploaded_bytes: self.uploaded_bytes_total(),
            updated_at: now,
        }
    }

    pub fn cancel(&mut self, now: DateTime<Utc>) -> CancelUploadSessionResponse {
        self.status = UploadSessionStatus::Canceled;
        self.updated_at = now;
        self.completed_at = None;
        self.last_error = None;

        CancelUploadSessionResponse {
            recording_id: self.recording_id.clone(),
            session_id: self.session_id.clone(),
            participant_id: self.participant_id.clone(),
            role: self.role,
            upload_id: self.upload_id.clone(),
            status: self.status,
            complete: false,
            updated_at: now,
        }
    }

    pub fn status_response(&self, now: DateTime<Utc>) -> GetUploadSessionStatusResponse {
        GetUploadSessionStatusResponse {
            recording_id: self.recording_id.clone(),
            session_id: self.session_id.clone(),
            participant_id: self.participant_id.clone(),
            role: self.role,
            upload_id: self.upload_id.clone(),
            status: self.status,
            expected_chunk_count: self.expected_chunk_count,
            uploaded_chunk_count: self.uploaded_chunk_count_total(),
            total_bytes: self.total_bytes,
            uploaded_bytes: self.uploaded_bytes_total(),
            missing_chunk_indexes: self.missing_chunk_indexes(),
            rejected_chunk_indexes: self.rejected_chunk_indexes(),
            updated_at: now,
            completed_at: self.completed_at,
        }
    }

    pub fn create_response(&self, now: DateTime<Utc>) -> CreateUploadSessionResponse {
        CreateUploadSessionResponse {
            recording_id: self.recording_id.clone(),
            session_id: self.session_id.clone(),
            participant_id: self.participant_id.clone(),
            role: self.role,
            upload_id: self.upload_id.clone(),
            status: self.status,
            accepted_chunk_size_bytes: self.chunk_size_bytes,
            expected_chunk_count: self.expected_chunk_count,
            uploaded_chunk_count: self.uploaded_chunk_count_total(),
            total_bytes: self.total_bytes,
            uploaded_bytes: self.uploaded_bytes_total(),
            missing_chunk_indexes: self.missing_chunk_indexes(),
            rejected_chunk_indexes: self.rejected_chunk_indexes(),
            updated_at: now,
            expires_at: self.expires_at,
        }
    }

    pub(crate) fn chunk_response(
        &self,
        chunk_index: u32,
        status: UploadChunkStatus,
        uploaded_bytes: u64,
        already_present: bool,
        now: DateTime<Utc>,
    ) -> UploadChunkResponse {
        UploadChunkResponse {
            recording_id: self.recording_id.clone(),
            upload_id: self.upload_id.clone(),
            chunk_index,
            status,
            uploaded_bytes,
            already_present,
            uploaded_chunk_count: self.uploaded_chunk_count_total(),
            missing_chunk_indexes: self.missing_chunk_indexes(),
            rejected_chunk_indexes: self.rejected_chunk_indexes(),
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UploadServiceError {
    Validation {
        code: &'static str,
        message: String,
        retryable: bool,
    },
    NotFound {
        code: &'static str,
        message: String,
    },
    Unavailable {
        message: String,
    },
    Storage {
        message: String,
    },
}

impl UploadServiceError {
    pub fn validation(code: &'static str, message: impl Into<String>, retryable: bool) -> Self {
        Self::Validation {
            code,
            message: message.into(),
            retryable,
        }
    }

    pub fn not_found(code: &'static str, message: impl Into<String>) -> Self {
        Self::NotFound {
            code,
            message: message.into(),
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::Unavailable {
            message: message.into(),
        }
    }

    pub fn storage(message: impl Into<String>) -> Self {
        Self::Storage {
            message: message.into(),
        }
    }
}

pub fn create_upload_id() -> String {
    format!("upl_{}", Uuid::new_v4().simple())
}

pub fn validate_create_request(
    request: &CreateUploadSessionRequest,
) -> Result<(), UploadServiceError> {
    let recording_id = request.recording_id.trim();
    let session_id = request.session_id.trim();
    let participant_id = request.participant_id.trim();

    if recording_id.is_empty() {
        return Err(UploadServiceError::validation(
            "invalid_recording_id",
            "Recording ID is required.",
            false,
        ));
    }

    if session_id.is_empty() {
        return Err(UploadServiceError::validation(
            "invalid_session_id",
            "Session ID is required.",
            false,
        ));
    }

    if participant_id.is_empty() {
        return Err(UploadServiceError::validation(
            "invalid_participant_id",
            "Participant ID is required.",
            false,
        ));
    }

    if request.total_bytes == 0 {
        return Err(UploadServiceError::validation(
            "invalid_total_bytes",
            "Total bytes must be greater than zero.",
            false,
        ));
    }

    if request.chunk_size_bytes == 0 {
        return Err(UploadServiceError::validation(
            "chunk_size_mismatch",
            "Chunk size must be greater than zero.",
            false,
        ));
    }

    if request.expected_chunk_count == 0 {
        return Err(UploadServiceError::validation(
            "invalid_expected_chunk_count",
            "Expected chunk count must be greater than zero.",
            false,
        ));
    }

    if request.manifest_version != MANIFEST_VERSION {
        return Err(UploadServiceError::validation(
            "invalid_manifest_version",
            "Unsupported manifest version.",
            false,
        ));
    }

    Ok(())
}

pub fn validate_chunk_request(
    chunk_index: u32,
    body_len: usize,
    total_bytes: u64,
    chunk_size_bytes: u64,
    idempotency_key: &str,
) -> Result<(), UploadServiceError> {
    if body_len == 0 {
        return Err(UploadServiceError::validation(
            "chunk_size_mismatch",
            "Chunk body must not be empty.",
            false,
        ));
    }

    if total_bytes == 0 {
        return Err(UploadServiceError::validation(
            "total_bytes_mismatch",
            "Total bytes must be greater than zero.",
            false,
        ));
    }

    if chunk_size_bytes == 0 {
        return Err(UploadServiceError::validation(
            "chunk_size_mismatch",
            "Chunk size must be greater than zero.",
            false,
        ));
    }

    if idempotency_key.trim().is_empty() {
        return Err(UploadServiceError::validation(
            "invalid_idempotency_key",
            "Idempotency key is required.",
            false,
        ));
    }

    let _ = chunk_index;
    Ok(())
}

pub fn compute_checksum_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}
