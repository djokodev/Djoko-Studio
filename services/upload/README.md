# Upload Service

This directory contains the Rust upload service for resumable browser
recordings.

## What is implemented

- Axum + Tokio HTTP service
- `GET /healthz`
- `GET /readyz`
- `POST /api/recordings/:recording_id/uploads`
- `GET /api/recordings/:recording_id/uploads/:upload_id`
- `PUT /api/recordings/:recording_id/uploads/:upload_id/chunks/:chunk_index`
- `POST /api/recordings/:recording_id/uploads/:upload_id/complete`
- `POST /api/recordings/:recording_id/uploads/:upload_id/cancel`
- local in-memory storage for tests
- S3/MinIO-backed storage for runtime
- CORS enabled for the browser client

## Storage configuration

The service reads these environment variables:

- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_REGION`
- `S3_FORCE_PATH_STYLE`

When all of those variables are present, the service connects to the configured
S3-compatible backend and stores:

- upload manifests at `recordings/{recordingId}/uploads/{uploadId}/manifest.json`
- chunk objects at `sessions/{sessionId}/participants/{participantId}/recordings/{recordingId}/uploads/{uploadId}/chunks/{chunkIndex}`

If the storage variables are missing, `GET /readyz` reports the service as
unavailable.

For local development with the bundled MinIO container, a typical setup is:

```bash
export S3_ENDPOINT=http://localhost:9000
export S3_BUCKET=dna-studio-recordings
export S3_ACCESS_KEY=djoko
export S3_SECRET_KEY=djoko_local_password
export S3_REGION=us-east-1
export S3_FORCE_PATH_STYLE=true
```

## Run it

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

## Test it

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

## Health checks

```bash
curl http://localhost:8082/healthz
curl http://localhost:8082/readyz
```
