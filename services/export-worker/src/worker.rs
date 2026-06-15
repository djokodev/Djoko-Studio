use std::{future::Future, io, time::Duration};

use tokio::time::{interval_at, Instant};
use tracing::{info, trace};

const SERVICE_NAME: &str = "export-worker";
const DEFAULT_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy)]
pub struct Worker {
    heartbeat_interval: Duration,
}

impl Default for Worker {
    fn default() -> Self {
        Self::new()
    }
}

impl Worker {
    pub const fn new() -> Self {
        Self {
            heartbeat_interval: DEFAULT_HEARTBEAT_INTERVAL,
        }
    }

    pub const fn service_name(&self) -> &'static str {
        SERVICE_NAME
    }

    pub const fn heartbeat_interval(&self) -> Duration {
        self.heartbeat_interval
    }

    pub async fn run(self) -> io::Result<()> {
        self.run_with_shutdown(Self::shutdown_signal()).await
    }

    pub async fn run_with_shutdown<S>(self, shutdown: S) -> io::Result<()>
    where
        S: Future<Output = io::Result<()>>,
    {
        info!(service = self.service_name(), "export worker started");

        let heartbeat_interval = self.heartbeat_interval();
        let mut shutdown = Box::pin(shutdown);
        let mut heartbeat = interval_at(Instant::now() + heartbeat_interval, heartbeat_interval);

        loop {
            tokio::select! {
                shutdown_result = &mut shutdown => {
                    shutdown_result?;
                    info!(service = self.service_name(), "export worker shutting down cleanly");
                    break;
                }
                _ = heartbeat.tick() => {
                    trace!(service = self.service_name(), "export worker waiting for future export jobs");
                }
            }
        }

        Ok(())
    }

    #[cfg(unix)]
    async fn shutdown_signal() -> io::Result<()> {
        use tokio::signal::unix::{signal, SignalKind};

        let mut sigterm = signal(SignalKind::terminate())?;

        tokio::select! {
            result = tokio::signal::ctrl_c() => result,
            _ = sigterm.recv() => Ok(()),
        }
    }

    #[cfg(not(unix))]
    async fn shutdown_signal() -> io::Result<()> {
        tokio::signal::ctrl_c().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::time::Duration;

    use tokio::time::timeout;

    #[test]
    fn default_service_name_is_export_worker() {
        assert_eq!(Worker::default().service_name(), SERVICE_NAME);
    }

    #[test]
    fn default_heartbeat_interval_is_thirty_seconds() {
        assert_eq!(
            Worker::default().heartbeat_interval(),
            Duration::from_secs(30)
        );
    }

    #[tokio::test]
    async fn run_exits_when_shutdown_resolves() {
        let worker = Worker::default();

        let result = timeout(
            Duration::from_secs(1),
            worker.run_with_shutdown(async { Ok::<(), io::Error>(()) }),
        )
        .await;

        assert!(result.is_ok(), "worker did not exit before timeout");
        assert!(result.expect("timeout completed").is_ok());
    }
}
