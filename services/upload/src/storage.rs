use std::{collections::HashMap, env, sync::Arc};

use aws_config::BehaviorVersion;
use aws_credential_types::{provider::SharedCredentialsProvider, Credentials};
use aws_sdk_s3::{config::Builder as S3ConfigBuilder, primitives::ByteStream, Client};
use chrono::Utc;
use tokio::sync::Mutex;
use tracing::info;

use crate::model::{
    compute_checksum_hex, validate_chunk_request, validate_create_request,
    CancelUploadSessionResponse, CompleteUploadSessionResponse, CreateUploadSessionRequest,
    CreateUploadSessionResponse, ErrorDetails, ErrorEnvelope, GetUploadSessionStatusResponse,
    UploadChunkRequest, UploadChunkResponse, UploadChunkStatus, UploadServiceError,
    UploadSessionRecord, UploadSessionStatus,
};

#[derive(Clone)]
pub enum UploadBackend {
    Unconfigured {
        message: String,
    },
    #[allow(dead_code)]
    InMemory(Arc<InMemoryUploadRepository>),
    S3(Arc<S3UploadRepository>),
}

impl UploadBackend {
    pub async fn from_env() -> Self {
        let endpoint = env::var("S3_ENDPOINT").ok();
        let bucket = env::var("S3_BUCKET").ok();
        let access_key = env::var("S3_ACCESS_KEY").ok();
        let secret_key = env::var("S3_SECRET_KEY").ok();
        let region = env::var("S3_REGION").ok();
        let force_path_style = env::var("S3_FORCE_PATH_STYLE")
            .ok()
            .and_then(|value| value.parse::<bool>().ok())
            .unwrap_or(true);

        let Some(endpoint) = endpoint else {
            return Self::Unconfigured {
                message: "S3_ENDPOINT is not configured.".to_string(),
            };
        };

        let Some(bucket) = bucket else {
            return Self::Unconfigured {
                message: "S3_BUCKET is not configured.".to_string(),
            };
        };

        let Some(access_key) = access_key else {
            return Self::Unconfigured {
                message: "S3_ACCESS_KEY is not configured.".to_string(),
            };
        };

        let Some(secret_key) = secret_key else {
            return Self::Unconfigured {
                message: "S3_SECRET_KEY is not configured.".to_string(),
            };
        };

        let Some(region) = region else {
            return Self::Unconfigured {
                message: "S3_REGION is not configured.".to_string(),
            };
        };

        match S3UploadRepository::new(
            endpoint,
            bucket,
            access_key,
            secret_key,
            region,
            force_path_style,
        )
        .await
        {
            Ok(repository) => Self::S3(Arc::new(repository)),
            Err(error) => Self::Unconfigured { message: error },
        }
    }

    #[allow(dead_code)]
    pub fn in_memory() -> Self {
        Self::InMemory(Arc::new(InMemoryUploadRepository::new()))
    }

    pub fn readiness_message(&self) -> Option<&str> {
        match self {
            Self::Unconfigured { message } => Some(message.as_str()),
            _ => None,
        }
    }

    pub fn is_ready(&self) -> bool {
        !matches!(self, Self::Unconfigured { .. })
    }

    pub async fn create_upload(
        &self,
        request: CreateUploadSessionRequest,
    ) -> Result<CreateUploadSessionResponse, UploadServiceError> {
        match self {
            Self::Unconfigured { message } => Err(UploadServiceError::unavailable(message.clone())),
            Self::InMemory(repository) => repository.create_upload(request).await,
            Self::S3(repository) => repository.create_upload(request).await,
        }
    }

    pub async fn get_status(
        &self,
        recording_id: &str,
        upload_id: &str,
    ) -> Result<GetUploadSessionStatusResponse, UploadServiceError> {
        match self {
            Self::Unconfigured { message } => Err(UploadServiceError::unavailable(message.clone())),
            Self::InMemory(repository) => repository.get_status(recording_id, upload_id).await,
            Self::S3(repository) => repository.get_status(recording_id, upload_id).await,
        }
    }

    pub async fn upload_chunk(
        &self,
        request: UploadChunkRequest,
    ) -> Result<UploadChunkResponse, UploadServiceError> {
        match self {
            Self::Unconfigured { message } => Err(UploadServiceError::unavailable(message.clone())),
            Self::InMemory(repository) => repository.upload_chunk(request).await,
            Self::S3(repository) => repository.upload_chunk(request).await,
        }
    }

    pub async fn complete_upload(
        &self,
        recording_id: &str,
        upload_id: &str,
    ) -> Result<CompleteUploadSessionResponse, UploadServiceError> {
        match self {
            Self::Unconfigured { message } => Err(UploadServiceError::unavailable(message.clone())),
            Self::InMemory(repository) => repository.complete_upload(recording_id, upload_id).await,
            Self::S3(repository) => repository.complete_upload(recording_id, upload_id).await,
        }
    }

    pub async fn cancel_upload(
        &self,
        recording_id: &str,
        upload_id: &str,
    ) -> Result<CancelUploadSessionResponse, UploadServiceError> {
        match self {
            Self::Unconfigured { message } => Err(UploadServiceError::unavailable(message.clone())),
            Self::InMemory(repository) => repository.cancel_upload(recording_id, upload_id).await,
            Self::S3(repository) => repository.cancel_upload(recording_id, upload_id).await,
        }
    }
}

#[derive(Default)]
struct InMemoryUploadStorage {
    sessions: HashMap<String, UploadSessionRecord>,
    chunks: HashMap<String, Vec<u8>>,
}

#[derive(Clone)]
pub struct InMemoryUploadRepository {
    storage: Arc<Mutex<InMemoryUploadStorage>>,
}

impl InMemoryUploadRepository {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self {
            storage: Arc::new(Mutex::new(InMemoryUploadStorage::default())),
        }
    }

    async fn create_upload(
        &self,
        request: CreateUploadSessionRequest,
    ) -> Result<CreateUploadSessionResponse, UploadServiceError> {
        validate_create_request(&request)?;
        let now = Utc::now();
        let upload_id = crate::model::create_upload_id();
        let record = UploadSessionRecord::new(&request, upload_id, now);
        let response = record.create_response(now);

        let mut storage = self.storage.lock().await;
        storage.sessions.insert(record.key().manifest_key(), record);

        Ok(response)
    }

    async fn get_status(
        &self,
        recording_id: &str,
        upload_id: &str,
    ) -> Result<GetUploadSessionStatusResponse, UploadServiceError> {
        let now = Utc::now();
        let storage = self.storage.lock().await;
        let record = find_record(&storage.sessions, recording_id, upload_id).ok_or_else(|| {
            UploadServiceError::not_found("invalid_upload_id", "Upload session not found.")
        })?;

        Ok(record.status_response(now))
    }

    async fn upload_chunk(
        &self,
        request: UploadChunkRequest,
    ) -> Result<UploadChunkResponse, UploadServiceError> {
        validate_chunk_request(
            request.chunk_index,
            request.body.len(),
            request.total_bytes,
            request.chunk_size_bytes,
            &request.idempotency_key,
        )?;

        let checksum = request
            .chunk_checksum
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| compute_checksum_hex(&request.body));

        let now = Utc::now();
        let (response, chunk_key, manifest_key, record_clone) = {
            let mut storage = self.storage.lock().await;
            let record = find_record_mut(
                &mut storage.sessions,
                &request.recording_id,
                &request.upload_id,
            )
            .ok_or_else(|| {
                UploadServiceError::not_found("invalid_upload_id", "Upload session not found.")
            })?;

            if record.status == UploadSessionStatus::Canceled {
                return Err(UploadServiceError::validation(
                    "upload_canceled",
                    "Upload session has been canceled.",
                    false,
                ));
            }

            if record.total_bytes != request.total_bytes {
                return Err(UploadServiceError::validation(
                    "total_bytes_mismatch",
                    "Total bytes do not match the upload session.",
                    false,
                ));
            }

            if request.chunk_index >= record.expected_chunk_count {
                return Err(UploadServiceError::validation(
                    "invalid_chunk_index",
                    "Chunk index is outside the expected range.",
                    false,
                ));
            }

            let response = record.apply_chunk(
                request.chunk_index,
                request.body.len() as u64,
                Some(checksum.clone()),
                now,
            )?;
            let chunk_key = record.key().chunk_key(request.chunk_index);
            let manifest_key = record.key().manifest_key();
            let record_clone = record.clone();

            (response, chunk_key, manifest_key, record_clone)
        };

        let mut storage = self.storage.lock().await;
        storage.chunks.insert(chunk_key, request.body.clone());
        storage.sessions.insert(manifest_key, record_clone);

        Ok(response)
    }

    async fn complete_upload(
        &self,
        recording_id: &str,
        upload_id: &str,
    ) -> Result<CompleteUploadSessionResponse, UploadServiceError> {
        let now = Utc::now();
        let (response, manifest_key, record_clone) = {
            let mut storage = self.storage.lock().await;
            let record = find_record_mut(&mut storage.sessions, recording_id, upload_id)
                .ok_or_else(|| {
                    UploadServiceError::not_found("invalid_upload_id", "Upload session not found.")
                })?;

            let response = record.complete(now);
            let manifest_key = record.key().manifest_key();
            let record_clone = record.clone();
            (response, manifest_key, record_clone)
        };

        let mut storage = self.storage.lock().await;
        storage.sessions.insert(manifest_key, record_clone);

        Ok(response)
    }

    async fn cancel_upload(
        &self,
        recording_id: &str,
        upload_id: &str,
    ) -> Result<CancelUploadSessionResponse, UploadServiceError> {
        let now = Utc::now();
        let (response, manifest_key, record_clone) = {
            let mut storage = self.storage.lock().await;
            let record = find_record_mut(&mut storage.sessions, recording_id, upload_id)
                .ok_or_else(|| {
                    UploadServiceError::not_found("invalid_upload_id", "Upload session not found.")
                })?;

            let response = record.cancel(now);
            let manifest_key = record.key().manifest_key();
            let record_clone = record.clone();
            (response, manifest_key, record_clone)
        };

        let mut storage = self.storage.lock().await;
        storage.sessions.insert(manifest_key, record_clone);

        Ok(response)
    }
}

#[derive(Clone)]
pub struct S3UploadRepository {
    client: Client,
    bucket: String,
}

impl S3UploadRepository {
    async fn new(
        endpoint: String,
        bucket: String,
        access_key: String,
        secret_key: String,
        region: String,
        force_path_style: bool,
    ) -> Result<Self, String> {
        let shared_config = aws_config::defaults(BehaviorVersion::latest())
            .region(aws_sdk_s3::config::Region::new(region))
            .credentials_provider(SharedCredentialsProvider::new(Credentials::new(
                access_key, secret_key, None, None, "static",
            )))
            .endpoint_url(endpoint)
            .load()
            .await;

        let config = S3ConfigBuilder::from(&shared_config)
            .force_path_style(force_path_style)
            .build();
        let client = Client::from_conf(config);
        let repository = Self { client, bucket };
        repository.ensure_bucket().await?;
        Ok(repository)
    }

    async fn ensure_bucket(&self) -> Result<(), String> {
        match self.client.head_bucket().bucket(&self.bucket).send().await {
            Ok(_) => Ok(()),
            Err(_) => {
                self.client
                    .create_bucket()
                    .bucket(&self.bucket)
                    .send()
                    .await
                    .map_err(|error| format!("Unable to create bucket: {error}"))?;
                info!(bucket = %self.bucket, "created upload bucket");
                Ok(())
            }
        }
    }

    async fn create_upload(
        &self,
        request: CreateUploadSessionRequest,
    ) -> Result<CreateUploadSessionResponse, UploadServiceError> {
        validate_create_request(&request)?;
        let now = Utc::now();
        let upload_id = crate::model::create_upload_id();
        let record = UploadSessionRecord::new(&request, upload_id, now);
        self.save_manifest(&record).await?;
        Ok(record.create_response(now))
    }

    async fn get_status(
        &self,
        recording_id: &str,
        upload_id: &str,
    ) -> Result<GetUploadSessionStatusResponse, UploadServiceError> {
        let now = Utc::now();
        let record = self.load_record(recording_id, upload_id).await?;
        Ok(record.status_response(now))
    }

    async fn upload_chunk(
        &self,
        request: UploadChunkRequest,
    ) -> Result<UploadChunkResponse, UploadServiceError> {
        validate_chunk_request(
            request.chunk_index,
            request.body.len(),
            request.total_bytes,
            request.chunk_size_bytes,
            &request.idempotency_key,
        )?;

        let checksum = request
            .chunk_checksum
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| compute_checksum_hex(&request.body));
        let now = Utc::now();
        let mut record = self
            .load_record(&request.recording_id, &request.upload_id)
            .await?;

        if record.status == UploadSessionStatus::Canceled {
            return Err(UploadServiceError::validation(
                "upload_canceled",
                "Upload session has been canceled.",
                false,
            ));
        }

        if record.total_bytes != request.total_bytes {
            return Err(UploadServiceError::validation(
                "total_bytes_mismatch",
                "Total bytes do not match the upload session.",
                false,
            ));
        }

        if request.chunk_index >= record.expected_chunk_count {
            return Err(UploadServiceError::validation(
                "invalid_chunk_index",
                "Chunk index is outside the expected range.",
                false,
            ));
        }

        let chunk_key = record.key().chunk_key(request.chunk_index);
        let existing = self.head_chunk(&chunk_key).await?;
        if let Some(existing) = existing {
            if chunk_head_matches_request(&existing, &checksum, request.body.len() as u64) {
                record.chunks[request.chunk_index as usize].status =
                    UploadChunkStatus::AlreadyPresent;
                record.chunks[request.chunk_index as usize].uploaded_bytes =
                    request.body.len() as u64;
                record.chunks[request.chunk_index as usize].expected_bytes = record.chunks
                    [request.chunk_index as usize]
                    .expected_bytes
                    .max(request.body.len() as u64);
                record.chunks[request.chunk_index as usize].checksum = Some(checksum.clone());
                record.chunks[request.chunk_index as usize].error_message = None;
                record.chunks[request.chunk_index as usize].updated_at = now;
                record.status = UploadSessionStatus::Uploading;
                record.updated_at = now;
                record.last_error = None;
                record.uploaded_bytes = record.uploaded_bytes_total();
                record.uploaded_chunk_count = record.uploaded_chunk_count_total();
                self.save_manifest(&record).await?;
                return Ok(record.chunk_response(
                    request.chunk_index,
                    UploadChunkStatus::AlreadyPresent,
                    request.body.len() as u64,
                    true,
                    now,
                ));
            }

            let existing_checksum = existing.checksum.unwrap_or_default();
            if existing_checksum != checksum || existing.size_bytes != request.body.len() as u64 {
                record.chunks[request.chunk_index as usize].status = UploadChunkStatus::Rejected;
                record.chunks[request.chunk_index as usize].error_message =
                    Some("Chunk checksum mismatch.".to_string());
                record.chunks[request.chunk_index as usize].updated_at = now;
                record.status = UploadSessionStatus::Incomplete;
                record.updated_at = now;
                record.last_error = Some("Chunk checksum mismatch.".to_string());
                self.save_manifest(&record).await?;
                return Ok(record.chunk_response(
                    request.chunk_index,
                    UploadChunkStatus::Rejected,
                    request.body.len() as u64,
                    false,
                    now,
                ));
            }
        }

        self.put_chunk(
            &chunk_key,
            &request.body,
            &request.mime_type,
            request.chunk_index,
            &checksum,
            &request.idempotency_key,
        )
        .await?;

        let response = record.apply_chunk(
            request.chunk_index,
            request.body.len() as u64,
            Some(checksum),
            now,
        )?;
        self.save_manifest(&record).await?;
        Ok(response)
    }

    async fn complete_upload(
        &self,
        recording_id: &str,
        upload_id: &str,
    ) -> Result<CompleteUploadSessionResponse, UploadServiceError> {
        let now = Utc::now();
        let mut record = self.load_record(recording_id, upload_id).await?;
        let response = record.complete(now);
        self.save_manifest(&record).await?;
        Ok(response)
    }

    async fn cancel_upload(
        &self,
        recording_id: &str,
        upload_id: &str,
    ) -> Result<CancelUploadSessionResponse, UploadServiceError> {
        let now = Utc::now();
        let mut record = self.load_record(recording_id, upload_id).await?;
        let response = record.cancel(now);
        self.save_manifest(&record).await?;
        Ok(response)
    }

    async fn save_manifest(&self, record: &UploadSessionRecord) -> Result<(), UploadServiceError> {
        let key = record.key().manifest_key();
        let payload = serde_json::to_vec(record).map_err(|error| {
            UploadServiceError::storage(format!("Unable to serialize manifest: {error}"))
        })?;

        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type("application/json")
            .body(ByteStream::from(payload))
            .send()
            .await
            .map_err(|error| {
                UploadServiceError::storage(format!("Unable to save manifest: {error}"))
            })?;

        Ok(())
    }

    async fn load_record(
        &self,
        recording_id: &str,
        upload_id: &str,
    ) -> Result<UploadSessionRecord, UploadServiceError> {
        let key = manifest_lookup_key(recording_id, upload_id);
        let payload = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|error| match error.to_string().contains("NoSuchKey") {
                true => {
                    UploadServiceError::not_found("invalid_upload_id", "Upload session not found.")
                }
                false => UploadServiceError::storage(format!("Unable to load manifest: {error}")),
            })?;

        let bytes = payload.body.collect().await.map_err(|error| {
            UploadServiceError::storage(format!("Unable to read manifest body: {error}"))
        })?;

        serde_json::from_slice::<UploadSessionRecord>(&bytes.into_bytes()).map_err(|error| {
            UploadServiceError::storage(format!("Unable to parse manifest: {error}"))
        })
    }

    async fn put_chunk(
        &self,
        key: &str,
        body: &[u8],
        mime_type: &str,
        chunk_index: u32,
        checksum: &str,
        idempotency_key: &str,
    ) -> Result<(), UploadServiceError> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(mime_type)
            .metadata("chunk-index", chunk_index.to_string())
            .metadata("checksum", checksum.to_string())
            .metadata("idempotency-key", idempotency_key.to_string())
            .body(ByteStream::from(body.to_vec()))
            .send()
            .await
            .map_err(|error| {
                UploadServiceError::storage(format!("Unable to store chunk: {error}"))
            })?;

        Ok(())
    }

    async fn head_chunk(&self, key: &str) -> Result<Option<ChunkHead>, UploadServiceError> {
        match self
            .client
            .head_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
        {
            Ok(output) => {
                let checksum = output
                    .metadata()
                    .and_then(|metadata| metadata.get("checksum"))
                    .cloned();
                Ok(Some(ChunkHead {
                    size_bytes: output.content_length().unwrap_or_default().max(0) as u64,
                    checksum,
                }))
            }
            Err(error) => {
                let text = error.to_string();
                if text.contains("NotFound") || text.contains("NoSuchKey") {
                    Ok(None)
                } else {
                    Err(UploadServiceError::storage(format!(
                        "Unable to inspect chunk: {error}"
                    )))
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
struct ChunkHead {
    size_bytes: u64,
    checksum: Option<String>,
}

fn chunk_head_matches_request(existing: &ChunkHead, checksum: &str, uploaded_bytes: u64) -> bool {
    existing.size_bytes == uploaded_bytes && existing.checksum.as_deref() == Some(checksum)
}

fn manifest_lookup_key(recording_id: &str, upload_id: &str) -> String {
    format!("recordings/{recording_id}/uploads/{upload_id}/manifest.json")
}

fn find_record<'a>(
    sessions: &'a HashMap<String, UploadSessionRecord>,
    recording_id: &str,
    upload_id: &str,
) -> Option<&'a UploadSessionRecord> {
    sessions
        .values()
        .find(|record| record.recording_id == recording_id && record.upload_id == upload_id)
}

fn find_record_mut<'a>(
    sessions: &'a mut HashMap<String, UploadSessionRecord>,
    recording_id: &str,
    upload_id: &str,
) -> Option<&'a mut UploadSessionRecord> {
    sessions
        .values_mut()
        .find(|record| record.recording_id == recording_id && record.upload_id == upload_id)
}

#[allow(clippy::module_name_repetitions)]
pub fn error_to_envelope(error: &UploadServiceError) -> ErrorEnvelope {
    ErrorEnvelope {
        error: ErrorDetails {
            code: match error {
                UploadServiceError::Validation { code, .. } => (*code).to_string(),
                UploadServiceError::NotFound { code, .. } => (*code).to_string(),
                UploadServiceError::Unavailable { .. } => "storage_unavailable".to_string(),
                UploadServiceError::Storage { .. } => "storage_error".to_string(),
            },
            message: match error {
                UploadServiceError::Validation { message, .. } => message.clone(),
                UploadServiceError::NotFound { message, .. } => message.clone(),
                UploadServiceError::Unavailable { message } => message.clone(),
                UploadServiceError::Storage { message } => message.clone(),
            },
            retryable: matches!(
                error,
                UploadServiceError::Unavailable { .. } | UploadServiceError::Storage { .. }
            ),
        },
    }
}

pub fn status_code_for_error(error: &UploadServiceError) -> axum::http::StatusCode {
    match error {
        UploadServiceError::Validation { .. } => axum::http::StatusCode::BAD_REQUEST,
        UploadServiceError::NotFound { .. } => axum::http::StatusCode::NOT_FOUND,
        UploadServiceError::Unavailable { .. } => axum::http::StatusCode::SERVICE_UNAVAILABLE,
        UploadServiceError::Storage { .. } => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
    }
}

#[cfg(test)]
mod tests {
    use super::{chunk_head_matches_request, ChunkHead};

    #[test]
    fn chunk_head_matches_request_requires_same_size_and_checksum() {
        let existing = ChunkHead {
            size_bytes: 3,
            checksum: Some("abc".to_string()),
        };

        assert!(chunk_head_matches_request(&existing, "abc", 3));
        assert!(!chunk_head_matches_request(&existing, "abc", 2));
        assert!(!chunk_head_matches_request(&existing, "def", 3));
    }
}
