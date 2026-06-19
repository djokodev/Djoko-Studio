use std::{path::Path, process::Stdio};

use async_trait::async_trait;
use tokio::process::Command;

use crate::{
    model::{ExportTargetRequest, TARGET_FORMAT, TARGET_RESOLUTION},
    service::ExportServiceError,
};

#[async_trait]
pub trait FfmpegRunner: Send + Sync {
    async fn is_available(&self) -> Result<(), ExportServiceError>;
    async fn render(
        &self,
        input_webm: &Path,
        output_mp4: &Path,
        target: &ExportTargetRequest,
    ) -> Result<(), ExportServiceError>;
}

#[derive(Debug, Clone)]
pub struct CommandFfmpegRunner {
    binary: String,
}

impl CommandFfmpegRunner {
    pub fn from_env() -> Self {
        Self {
            binary: std::env::var("FFMPEG_BINARY").unwrap_or_else(|_| "ffmpeg".to_string()),
        }
    }

    fn output_arguments(input_webm: &Path, output_mp4: &Path) -> Vec<String> {
        vec![
            "-y".to_string(),
            "-i".to_string(),
            input_webm.display().to_string(),
            "-vf".to_string(),
            "scale=-2:1080,pad=1920:1080:(ow-iw)/2:(oh-ih)/2".to_string(),
            "-c:v".to_string(),
            "libx264".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            output_mp4.display().to_string(),
        ]
    }
}

#[async_trait]
impl FfmpegRunner for CommandFfmpegRunner {
    async fn is_available(&self) -> Result<(), ExportServiceError> {
        let output = Command::new(&self.binary)
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .await
            .map_err(|error| {
                ExportServiceError::unavailable(format!("FFmpeg binary not found: {error}"))
            })?;

        if output.status.success() {
            Ok(())
        } else {
            Err(ExportServiceError::unavailable(
                "FFmpeg binary not available.".to_string(),
            ))
        }
    }

    async fn render(
        &self,
        input_webm: &Path,
        output_mp4: &Path,
        target: &ExportTargetRequest,
    ) -> Result<(), ExportServiceError> {
        if target.format.trim().is_empty() || target.resolution.trim().is_empty() {
            return Err(ExportServiceError::invalid_request(
                "invalid_target",
                "Export target is incomplete.",
            ));
        }

        if target.format.trim() != TARGET_FORMAT || target.resolution.trim() != TARGET_RESOLUTION {
            return Err(ExportServiceError::invalid_request(
                "unsupported_target",
                "Only MP4 1920x1080 exports are supported in this slice.",
            ));
        }

        let status = Command::new(&self.binary)
            .args(Self::output_arguments(input_webm, output_mp4))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map_err(|error| {
                ExportServiceError::internal(format!("Unable to run FFmpeg: {error}"))
            })?;

        if status.success() {
            Ok(())
        } else {
            Err(ExportServiceError::processing(
                "ffmpeg_failed",
                "FFmpeg failed to render the export.",
            ))
        }
    }
}

#[derive(Debug, Clone)]
pub struct FakeFfmpegRunner {
    available: bool,
    render_result: Result<(), ExportServiceError>,
    output_bytes: Vec<u8>,
}

impl FakeFfmpegRunner {
    pub fn available() -> Self {
        Self {
            available: true,
            render_result: Ok(()),
            output_bytes: b"fake-mp4".to_vec(),
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            available: false,
            render_result: Err(ExportServiceError::unavailable(message.into())),
            output_bytes: Vec::new(),
        }
    }

    pub fn with_render_result(result: Result<(), ExportServiceError>) -> Self {
        Self {
            available: true,
            render_result: result,
            output_bytes: b"fake-mp4".to_vec(),
        }
    }
}

#[async_trait]
impl FfmpegRunner for FakeFfmpegRunner {
    async fn is_available(&self) -> Result<(), ExportServiceError> {
        if self.available {
            Ok(())
        } else {
            Err(ExportServiceError::unavailable(
                "FFmpeg binary not found.".to_string(),
            ))
        }
    }

    async fn render(
        &self,
        _input_webm: &Path,
        output_mp4: &Path,
        _target: &ExportTargetRequest,
    ) -> Result<(), ExportServiceError> {
        match self.render_result.clone() {
            Ok(()) => {
                tokio::fs::write(output_mp4, &self.output_bytes)
                    .await
                    .map_err(|error| {
                        ExportServiceError::internal(format!(
                            "Unable to write fake FFmpeg output: {error}"
                        ))
                    })?;
                Ok(())
            }
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_arguments_preserve_aspect_ratio() {
        let input = Path::new("/tmp/input.webm");
        let output = Path::new("/tmp/output.mp4");

        let arguments = CommandFfmpegRunner::output_arguments(input, output);
        assert!(arguments
            .iter()
            .any(|argument| argument == "scale=-2:1080,pad=1920:1080:(ow-iw)/2:(oh-ih)/2"));
        assert!(!arguments
            .iter()
            .any(|argument| argument == "scale=1920:1080"));
    }
}
