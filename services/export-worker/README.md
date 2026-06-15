# Export Worker

This directory contains the minimal Rust export worker scaffold for Djoko Studio.

## Why this is a worker

Export rendering is a long-running background concern, not a request/response API.
This service is meant to stay alive, wait for work, and shut down cleanly when interrupted.

## What is implemented now

- a Rust binary crate
- Tokio-based startup and graceful shutdown handling
- a long-running idle loop with a heartbeat interval
- tracing-based logging
- simple unit tests for the worker foundation

## What is intentionally not implemented yet

- FFmpeg orchestration
- export job consumption
- object storage access
- database access
- export composition or rendering logic
- status event publishing
- retry or idempotency policies

## How to run

```bash
cd services/export-worker
cargo run
```

Press Ctrl+C to stop the worker.

## How to test

```bash
cd services/export-worker
cargo test
```

## How to stop it manually

Press Ctrl+C to stop the worker.
