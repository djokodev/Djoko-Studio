mod model;
mod routes;
mod server;
mod storage;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();

    let port = server::port_from_env();
    let state = server::state_from_env().await;
    server::run(port, state).await
}
