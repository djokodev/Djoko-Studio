mod routes;
mod server;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt::init();

    let port = server::port_from_env();
    server::run(port).await
}
