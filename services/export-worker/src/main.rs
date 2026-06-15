mod worker;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let worker = worker::Worker::default();

    if let Err(error) = worker.run().await {
        tracing::error!(error = %error, "export worker exited with an error");
        std::process::exit(1);
    }
}
