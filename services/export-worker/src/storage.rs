use std::{collections::HashMap, env, path::Path, pin::Pin, sync::Arc};

use async_trait::async_trait;
use aws_config::BehaviorVersion;
use aws_credential_types::{provider::SharedCredentialsProvider, Credentials};
use aws_sdk_s3::{config::Builder as S3ConfigBuilder, primitives::ByteStream, Client};
use aws_smithy_types::error::metadata::ProvideErrorMetadata;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncRead;
use tokio::sync::Mutex;
use tracing::info;

use crate::{
    model::{ErrorEnvelope, ExportReadyzResponse},
    service::ExportServiceError,
};

#[derive(Debug, Clone)]
pub struct ObjectData {
    pub bytes: Vec<u8>,
    pub content_type: String,
}

pub enum ExportDownloadBody {
    Bytes(Vec<u8>),
    Stream(Pin<Box<dyn AsyncRead + Send>>),
}

#[async_trait]
pub trait ExportStorage: Send + Sync {
    async fn ready(&self) -> Result<(), ExportServiceError>;
    async fn get_object(&self, key: &str) -> Result<Vec<u8>, ExportServiceError>;
    async fn get_file_object(&self, key: &str) -> Result<ExportDownloadBody, ExportServiceError>;
    async fn put_object(
        &self,
        key: &str,
        body: Vec<u8>,
        content_type: &str,
    ) -> Result<(), ExportServiceError>;
    async fn put_file_object(
        &self,
        key: &str,
        path: &Path,
        content_type: &str,
    ) -> Result<(), ExportServiceError>;
}

#[async_trait]
pub trait StorageBackendExt {
    async fn from_env() -> Self
    where
        Self: Sized;
    fn into_shared(self) -> Arc<dyn ExportStorage>;
}

#[derive(Clone)]
pub enum StorageBackend {
    Unconfigured { message: String },
    Memory(Arc<MemoryObjectStore>),
    S3(Arc<S3ObjectStore>),
}

impl StorageBackend {
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

        match S3ObjectStore::new(
            endpoint,
            bucket,
            access_key,
            secret_key,
            region,
            force_path_style,
        )
        .await
        {
            Ok(store) => Self::S3(Arc::new(store)),
            Err(message) => Self::Unconfigured { message },
        }
    }

    #[cfg(test)]
    pub fn memory() -> Self {
        Self::Memory(Arc::new(MemoryObjectStore::new()))
    }

    pub fn readiness_message(&self) -> Option<&str> {
        match self {
            Self::Unconfigured { message } => Some(message.as_str()),
            _ => None,
        }
    }

    pub fn into_shared(self) -> Arc<dyn ExportStorage> {
        match self {
            Self::Unconfigured { message } => Arc::new(UnconfiguredStorage { message }),
            Self::Memory(store) => store,
            Self::S3(store) => store,
        }
    }
}

#[async_trait]
impl ExportStorage for UnconfiguredStorage {
    async fn ready(&self) -> Result<(), ExportServiceError> {
        Err(ExportServiceError::unavailable(self.message.clone()))
    }

    async fn get_object(&self, _key: &str) -> Result<Vec<u8>, ExportServiceError> {
        Err(ExportServiceError::unavailable(self.message.clone()))
    }

    async fn get_file_object(&self, _key: &str) -> Result<ExportDownloadBody, ExportServiceError> {
        Err(ExportServiceError::unavailable(self.message.clone()))
    }

    async fn put_object(
        &self,
        _key: &str,
        _body: Vec<u8>,
        _content_type: &str,
    ) -> Result<(), ExportServiceError> {
        Err(ExportServiceError::unavailable(self.message.clone()))
    }

    async fn put_file_object(
        &self,
        _key: &str,
        _path: &Path,
        _content_type: &str,
    ) -> Result<(), ExportServiceError> {
        Err(ExportServiceError::unavailable(self.message.clone()))
    }
}

#[derive(Clone)]
struct UnconfiguredStorage {
    message: String,
}

#[derive(Default)]
struct InMemoryObjectStoreState {
    objects: HashMap<String, ObjectData>,
}

#[derive(Clone)]
pub struct MemoryObjectStore {
    state: Arc<Mutex<InMemoryObjectStoreState>>,
}

impl MemoryObjectStore {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(InMemoryObjectStoreState::default())),
        }
    }
}

impl Default for MemoryObjectStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ExportStorage for MemoryObjectStore {
    async fn ready(&self) -> Result<(), ExportServiceError> {
        Ok(())
    }

    async fn get_object(&self, key: &str) -> Result<Vec<u8>, ExportServiceError> {
        let state = self.state.lock().await;
        let Some(object) = state.objects.get(key) else {
            return Err(ExportServiceError::not_found(
                "export_not_found",
                "Export asset not found.",
            ));
        };

        Ok(object.bytes.clone())
    }

    async fn get_file_object(&self, key: &str) -> Result<ExportDownloadBody, ExportServiceError> {
        let bytes = self.get_object(key).await?;
        Ok(ExportDownloadBody::Bytes(bytes))
    }

    async fn put_object(
        &self,
        key: &str,
        body: Vec<u8>,
        content_type: &str,
    ) -> Result<(), ExportServiceError> {
        let mut state = self.state.lock().await;
        state.objects.insert(
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
        let body = tokio::fs::read(path).await.map_err(|error| {
            ExportServiceError::internal(format!("Unable to read export file: {error}"))
        })?;
        self.put_object(key, body, content_type).await
    }
}

#[derive(Clone)]
pub struct S3ObjectStore {
    client: Client,
    bucket: String,
}

impl S3ObjectStore {
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
        let store = Self { client, bucket };
        store.ensure_bucket().await?;
        Ok(store)
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
                    .map_err(|error| format!("Unable to create export bucket: {error}"))?;
                info!(bucket = %self.bucket, "created export bucket");
                Ok(())
            }
        }
    }
}

#[async_trait]
impl ExportStorage for S3ObjectStore {
    async fn ready(&self) -> Result<(), ExportServiceError> {
        self.client
            .head_bucket()
            .bucket(&self.bucket)
            .send()
            .await
            .map(|_| ())
            .map_err(|error| {
                ExportServiceError::unavailable(format!("S3 bucket unavailable: {error}"))
            })
    }

    async fn get_object(&self, key: &str) -> Result<Vec<u8>, ExportServiceError> {
        let output = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|error| {
                let code = error
                    .as_service_error()
                    .and_then(|service_error| service_error.code());
                let status = error
                    .raw_response()
                    .map(|response| response.status().as_u16());

                if is_missing_s3_object_error(code, status) {
                    ExportServiceError::not_found("export_not_found", "Export asset not found.")
                } else {
                    ExportServiceError::internal(format!("Unable to read export asset: {error}"))
                }
            })?;

        let bytes = output.body.collect().await.map_err(|error| {
            ExportServiceError::internal(format!("Unable to read body: {error}"))
        })?;

        Ok(bytes.into_bytes().to_vec())
    }

    async fn get_file_object(&self, key: &str) -> Result<ExportDownloadBody, ExportServiceError> {
        let output = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|error| {
                let code = error
                    .as_service_error()
                    .and_then(|service_error| service_error.code());
                let status = error
                    .raw_response()
                    .map(|response| response.status().as_u16());

                if is_missing_s3_object_error(code, status) {
                    ExportServiceError::not_found("export_not_found", "Export asset not found.")
                } else {
                    ExportServiceError::internal(format!("Unable to read export asset: {error}"))
                }
            })?;

        Ok(ExportDownloadBody::Stream(Box::pin(
            output.body.into_async_read(),
        )))
    }

    async fn put_object(
        &self,
        key: &str,
        body: Vec<u8>,
        content_type: &str,
    ) -> Result<(), ExportServiceError> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .body(ByteStream::from(body))
            .send()
            .await
            .map_err(|error| {
                ExportServiceError::internal(format!("Unable to store export asset: {error}"))
            })?;

        Ok(())
    }

    async fn put_file_object(
        &self,
        key: &str,
        path: &Path,
        content_type: &str,
    ) -> Result<(), ExportServiceError> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .body(ByteStream::from_path(path).await.map_err(|error| {
                ExportServiceError::internal(format!(
                    "Unable to open export file for upload: {error}"
                ))
            })?)
            .send()
            .await
            .map_err(|error| {
                ExportServiceError::internal(format!("Unable to store export asset: {error}"))
            })?;

        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StorageReadyzView {
    pub status: String,
    pub service: String,
    pub storage: String,
    pub ffmpeg: String,
    pub message: Option<String>,
}

pub fn storage_readyz_view(
    message: Option<String>,
    ffmpeg_available: bool,
) -> ExportReadyzResponse {
    let status = if message.is_none() && ffmpeg_available {
        "ok"
    } else {
        "degraded"
    };

    ExportReadyzResponse {
        status: status.to_string(),
        service: "export-worker".to_string(),
        storage: "ready".to_string(),
        ffmpeg: if ffmpeg_available {
            "available".to_string()
        } else {
            "unavailable".to_string()
        },
        message,
    }
}

fn is_missing_s3_object_error(code: Option<&str>, status: Option<u16>) -> bool {
    matches!(code, Some("NoSuchKey") | Some("NotFound")) || status == Some(404)
}

pub fn error_envelope(
    code: impl Into<String>,
    message: impl Into<String>,
    retryable: bool,
) -> ErrorEnvelope {
    ErrorEnvelope {
        error: crate::model::ErrorDetails {
            code: code.into(),
            message: message.into(),
            retryable,
        },
    }
}
