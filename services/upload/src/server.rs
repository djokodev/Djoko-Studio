use std::{env, net::SocketAddr};

use axum::serve;
use tokio::net::TcpListener;
use tracing::info;

pub const DEFAULT_PORT: u16 = 8082;

pub fn port_from_env() -> u16 {
    env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT)
}

pub async fn run(port: u16) -> std::io::Result<()> {
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;

    info!(service = "upload", %addr, "starting upload service");

    serve(listener, crate::routes::router())
        .with_graceful_shutdown(shutdown_signal())
        .await
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    info!(service = "upload", "shutdown signal received");
}
