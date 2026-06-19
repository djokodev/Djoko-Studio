use std::{path::Path, process::Stdio, time::Duration};

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
    timeout: Duration,
}

impl CommandFfmpegRunner {
    pub fn from_env() -> Self {
        Self {
            binary: std::env::var("FFMPEG_BINARY").unwrap_or_else(|_| "ffmpeg".to_string()),
            timeout: duration_from_env("FFMPEG_TIMEOUT_SECONDS", 1800),
        }
    }

    #[cfg(test)]
    fn with_binary(binary: impl Into<String>) -> Self {
        Self {
            binary: binary.into(),
            timeout: Duration::from_secs(1800),
        }
    }

    #[cfg(test)]
    fn with_binary_and_timeout(binary: impl Into<String>, timeout: Duration) -> Self {
        Self {
            binary: binary.into(),
            timeout,
        }
    }

    fn output_arguments(input_webm: &Path, output_mp4: &Path) -> Vec<String> {
        vec![
            "-y".to_string(),
            "-fflags".to_string(),
            "+genpts".to_string(),
            "-i".to_string(),
            input_webm.display().to_string(),
            "-vf".to_string(),
            "fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2".to_string(),
            "-c:v".to_string(),
            "libx264".to_string(),
            "-preset".to_string(),
            "veryfast".to_string(),
            "-crf".to_string(),
            "23".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "160k".to_string(),
            "-movflags".to_string(),
            "+faststart".to_string(),
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

        let output = tokio::time::timeout(self.timeout, async {
            Command::new(&self.binary)
                .args(Self::output_arguments(input_webm, output_mp4))
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .output()
                .await
        })
        .await
        .map_err(|_| {
            ExportServiceError::processing_retryable(
                "ffmpeg_timeout",
                format!("FFmpeg timed out after {} seconds.", self.timeout.as_secs()),
            )
        })?
        .map_err(|error| ExportServiceError::internal(format!("Unable to run FFmpeg: {error}")))?;

        if output.status.success() {
            Ok(())
        } else {
            let stderr = summarize_stderr(&output.stderr, 1000, 4000);
            Err(ExportServiceError::processing(
                "ffmpeg_failed",
                format!("FFmpeg failed to render the export. {stderr}"),
            ))
        }
    }
}

fn duration_from_env(name: &str, default_seconds: u64) -> Duration {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map(Duration::from_secs)
        .unwrap_or_else(|| Duration::from_secs(default_seconds))
}

fn summarize_stderr(stderr: &[u8], head_limit: usize, tail_limit: usize) -> String {
    let decoded = String::from_utf8_lossy(stderr);
    let trimmed = decoded.trim();

    if trimmed.is_empty() {
        return "No FFmpeg stderr output was captured.".to_string();
    }

    let chars: Vec<char> = trimmed.chars().collect();
    let len = chars.len();

    if len <= tail_limit {
        return format!("stderr: {}", chars.iter().collect::<String>());
    }

    let head_end = head_limit.min(len);
    let tail_start = len.saturating_sub(tail_limit);

    if tail_start <= head_end {
        return format!("stderr: {}", chars.iter().collect::<String>());
    }

    let head: String = chars[..head_end].iter().collect();
    let tail: String = chars[tail_start..].iter().collect();

    if head.is_empty() {
        format!("stderr: {tail}")
    } else {
        format!("stderr: {head}... [stderr truncated] ...{tail}")
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
    use std::fs;

    use tempfile::tempdir;
    use tokio::runtime::Runtime;

    #[test]
    fn ffmpeg_arguments_include_veryfast_crf_audio_bitrate_and_faststart() {
        let input = Path::new("/tmp/input.webm");
        let output = Path::new("/tmp/output.mp4");

        let arguments = CommandFfmpegRunner::output_arguments(input, output);
        assert!(arguments.iter().any(|argument| argument == "+genpts"));
        assert!(arguments
            .iter()
            .any(|argument| argument.contains("fps=30,")));
        assert!(arguments
            .iter()
            .any(|argument| argument.contains("force_original_aspect_ratio=decrease")));
        assert!(arguments
            .iter()
            .any(|argument| argument.contains("pad=1920:1080:(ow-iw)/2:(oh-ih)/2")));
        assert!(arguments.iter().any(|argument| argument == "veryfast"));
        assert!(arguments.iter().any(|argument| argument == "23"));
        assert!(arguments.iter().any(|argument| argument == "160k"));
        assert!(arguments.iter().any(|argument| argument == "+faststart"));
        assert!(!arguments
            .iter()
            .any(|argument| argument == "scale=1920:1080"));
    }

    #[test]
    fn ffmpeg_arguments_normalize_output_fps_to_30() {
        let input = Path::new("/tmp/input.webm");
        let output = Path::new("/tmp/output.mp4");

        let arguments = CommandFfmpegRunner::output_arguments(input, output);
        assert!(arguments
            .iter()
            .any(|argument| argument.starts_with("fps=30,")));
    }

    #[test]
    fn ffmpeg_timeout_returns_retryable_timeout_error() {
        let temp_dir = tempdir().expect("temp dir");
        let script_path = temp_dir.path().join("slow-ffmpeg.sh");
        let script = "#!/bin/sh\nsleep 2\n";
        fs::write(&script_path, script).expect("write fake ffmpeg script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&script_path)
                .expect("script metadata")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&script_path, permissions).expect("set executable bit");
        }

        let runner = CommandFfmpegRunner::with_binary_and_timeout(
            script_path.display().to_string(),
            Duration::from_millis(50),
        );
        let runtime = Runtime::new().expect("tokio runtime");
        let error = runtime
            .block_on(async {
                runner
                    .render(
                        Path::new("/tmp/input.webm"),
                        Path::new("/tmp/output.mp4"),
                        &ExportTargetRequest {
                            format: TARGET_FORMAT.to_string(),
                            resolution: TARGET_RESOLUTION.to_string(),
                        },
                    )
                    .await
            })
            .expect_err("render should time out");

        assert_eq!(error.code(), "ffmpeg_timeout");
        assert!(error.retryable());
        assert!(error.message().contains("timed out"));
    }

    #[test]
    fn render_failure_includes_tail_of_ffmpeg_stderr() {
        let temp_dir = tempdir().expect("temp dir");
        let script_path = temp_dir.path().join("fake-ffmpeg.sh");
        let head = "ffmpeg version sample line\n".repeat(220);
        let tail = "FINAL_FFMPEG_ERROR: non-monotonous DTS";
        let script = format!(
            "#!/bin/sh\nprintf '%s\\n%s\\n' \"{}\" \"{}\" >&2\nexit 1\n",
            head, tail
        );
        fs::write(&script_path, script).expect("write fake ffmpeg script");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&script_path)
                .expect("script metadata")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&script_path, permissions).expect("set executable bit");
        }

        let runner = CommandFfmpegRunner::with_binary(script_path.display().to_string());
        let runtime = Runtime::new().expect("tokio runtime");
        let error = runtime
            .block_on(async {
                runner
                    .render(
                        Path::new("/tmp/input.webm"),
                        Path::new("/tmp/output.mp4"),
                        &ExportTargetRequest {
                            format: TARGET_FORMAT.to_string(),
                            resolution: TARGET_RESOLUTION.to_string(),
                        },
                    )
                    .await
            })
            .expect_err("render should fail");

        assert_eq!(error.code(), "ffmpeg_failed");
        assert!(error.message().contains("stderr:"));
        assert!(error.message().contains("[stderr truncated]"));
        assert!(error
            .message()
            .contains("FINAL_FFMPEG_ERROR: non-monotonous DTS"));
    }
}
