# Media Worker

This crate is the minimal Rust worker scaffold for Djoko Studio's media pipeline.

## Why this is a worker

Media processing is a long-running background concern, not a request/response API.
This service is meant to stay alive, wait for work, and shut down cleanly when
interrupted.

## What is implemented now

- a Rust binary crate
- Tokio-based startup and graceful shutdown handling
- a long-running idle loop with a heartbeat interval
- tracing-based logging
- simple unit tests for the worker foundation

## What is intentionally not implemented yet

- FFmpeg orchestration
- NATS or other queue consumers
- object storage access
- database access
- media validation and transformation logic
- job scheduling or retry policies

## How to run

```bash
cd services/media-worker
cargo run
```

Press Ctrl+C to stop the worker.

## How to test

```bash
cd services/media-worker
cargo test
```

## Manual stop

Press Ctrl+C to stop the worker.
