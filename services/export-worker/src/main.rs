use std::{net::SocketAddr, sync::Arc};

use export_worker::{ffmpeg::CommandFfmpegRunner, storage::StorageBackend};
use tracing::error;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let port = std::env::var("EXPORT_WORKER_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8083);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let storage = StorageBackend::from_env().await;
    let ffmpeg = Arc::new(CommandFfmpegRunner::from_env());

    let app = export_worker::build_router(storage.into_shared(), ffmpeg);

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(error) => {
            error!(error = %error, "failed to bind export worker");
            std::process::exit(1);
        }
    };

    if let Err(error) = axum::serve(listener, app).await {
        error!(error = %error, "export worker exited with an error");
        std::process::exit(1);
    }
}
