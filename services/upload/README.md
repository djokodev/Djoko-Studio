# Upload Service

This directory contains the minimal Rust upload service scaffold for Djoko Studio.

## What is implemented now

- Rust binary service built with Tokio and Axum
- `GET /healthz`
- `GET /readyz`
- JSON responses with `status: ok` and `service: upload`
- configurable port through `PORT`
- basic startup and shutdown behavior
- route tests for success, `404`, and `405` behavior

## What is intentionally not implemented yet

- Tus-compatible resumable uploads
- chunk upload handling
- upload resume logic
- checksum validation
- missing chunk detection
- upload progress tracking
- object storage writes
- database access
- authentication or sessions
- NATS integration
- Dockerfile or Docker Compose changes

## Run It

```bash
cd services/upload
cargo test
cargo run
```

Override the default port:

```bash
PORT=8083 cargo run
```

The default port is `8082`.

## Test It

```bash
cd services/upload
cargo fmt --check
cargo test
cargo check
```

If available in the local environment:

```bash
cargo clippy -- -D warnings
```

## Health Endpoints

```bash
curl http://localhost:8082/healthz
curl http://localhost:8082/readyz
```
