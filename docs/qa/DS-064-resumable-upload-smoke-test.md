# DS-064 Resumable Upload Smoke Test

## Goal

Verify that a persisted browser recording can be uploaded chunk by chunk to the
Rust upload service, resumed after refresh, and marked as uploaded without
deleting the local recording copy.

## Prerequisites

Start the local infrastructure and app services:

```bash
docker compose -f infra/local/docker-compose.yml up -d postgres minio
cd services/api && go run ./cmd/api
cd services/signaling && go run ./cmd/signaling
cd services/upload && \
  S3_ENDPOINT=http://localhost:9000 \
  S3_BUCKET=dna-studio-recordings \
  S3_ACCESS_KEY=djoko \
  S3_SECRET_KEY=djoko_local_password \
  S3_REGION=us-east-1 \
  S3_FORCE_PATH_STYLE=true \
  cargo run
cd apps/web-studio && \
  VITE_API_BASE_URL=http://localhost:8080 \
  VITE_UPLOAD_BASE_URL=http://localhost:8082 \
  npm run dev
```

## Manual Verification Checklist

- [ ] **1. Create a local recording**
  - Open the host page at `http://localhost:5173`.
  - Start preview, create a session, and record a short clip with the host flow.
  - Stop the recording and confirm the local playback preview appears.

- [ ] **2. Confirm local copy visibility**
  - Open the upload readiness panel.
  - Confirm the panel shows that a local recording exists.
  - Confirm the action is labeled `Upload local copy`.
  - Confirm the UI still shows the local recording as separate from the server
    upload state.

- [ ] **3. Upload the local chunks**
  - Click `Upload local copy`.
  - Confirm the queue transitions through `initializing`, `ready`, and
    `uploading`.
  - Confirm chunk progress advances one chunk at a time.
  - Confirm the byte progress updates as chunks finish.

- [ ] **4. Refresh and resume**
  - Refresh the page while an upload is in progress or after a partial upload.
  - Confirm the upload panel rehydrates persisted queue state.
  - Confirm the client reconciles against the server status endpoint.
  - Confirm already uploaded chunks are skipped after refresh.

- [ ] **5. Complete the upload**
  - Let the upload finish.
  - Confirm the queue status becomes `uploaded`.
  - Confirm the panel shows the completed upload state separately from the
    local recording copy.
  - Confirm the local browser recording is still present until manually cleared.

- [ ] **6. Cancel and retry paths**
  - Start another upload and cancel it.
  - Confirm the queue status becomes `canceled`.
  - Trigger a failure by temporarily stopping the upload service, then resume
    once it is available again.
  - Confirm the UI exposes the last error and allows manual retry.

- [ ] **7. Server status validation**
  - Query `GET /api/recordings/{recordingId}/uploads/{uploadId}`.
  - Confirm the response reports missing chunks before completion.
  - Confirm the response reports no missing chunks once the upload is complete.

## Manual Smoke Result

Smoke test completed successfully.

- Local recording created: pass
- Chunk-by-chunk upload: pass
- Refresh resume: pass
- Final completion: pass
- Cancel/retry behavior: pass
- Server status reconciliation: pass

