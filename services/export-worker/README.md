# Export Worker

This directory contains the Rust export worker for the DS-065 local export slice.

## Why this is a worker

Export rendering is a long-running concern, not a request/response API.
This service stays alive, checks readiness, receives export requests, renders
the final MP4, and shuts down cleanly when interrupted.

## What is implemented now

- a Rust binary crate
- Tokio-based startup and graceful shutdown handling
- a local HTTP API with readiness, export creation, export inspection, and download routes
- MinIO/S3 object storage access
- FFmpeg command execution through `FFMPEG_BINARY`
- export manifest persistence in MinIO
- a temporary WebM reconstruction step before MP4 rendering
- tracing-based logging
- attempt-scoped export artifact keys to protect newer successful exports from stale async jobs
- unit tests for readiness, validation, manifest persistence, and download behavior

## What is intentionally not implemented yet

- queue consumers or NATS ingestion
- retry or requeue policies
- export presets beyond MP4 1920x1080
- UI access from anything other than the local web studio client
- database access
- production hardening for the direct browser-to-worker path

## How to run

```bash
cd services/export-worker
EXPORT_WORKER_PORT=8083 \
S3_ENDPOINT=http://localhost:9000 \
S3_BUCKET=dna-studio-recordings \
S3_ACCESS_KEY=djoko_minio \
S3_SECRET_KEY=djoko_minio_local_2026_change_me \
S3_REGION=us-east-1 \
S3_FORCE_PATH_STYLE=true \
FFMPEG_BINARY=ffmpeg \
cargo run
```

Press Ctrl+C to stop the worker.

## How to test

```bash
cd services/export-worker
cargo test
```

## Configuration

The worker reads:

- `EXPORT_WORKER_PORT` for the HTTP port, defaulting to `8083`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_REGION`
- `S3_FORCE_PATH_STYLE`, defaulting to `true`
- `FFMPEG_BINARY`, defaulting to `ffmpeg`
- `PROCESSING_STALE_AFTER_SECONDS`, defaulting to `1800`
- `FFMPEG_TIMEOUT_SECONDS`, defaulting to `1800`

`EXPORT_WORKER_PORT` and `FFMPEG_BINARY` are the canonical local configuration
names for this slice.

## Artifact safety

Final MP4 artifacts are stored under attempt-scoped keys:

`sessions/{sessionId}/participants/{participantId}/recordings/{recordingId}/exports/{exportId}/attempts/{attemptId}/output-1080p.mp4`

This prevents stale background jobs from overwriting a newer successful export
artifact. The current manifest `outputObjectKey` remains the source of truth
for download.

## Contract

See [`docs/contracts/export-worker-api.md`](../../docs/contracts/export-worker-api.md)
for the local worker contract and MinIO key layout.
