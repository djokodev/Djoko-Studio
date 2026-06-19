# Export Worker API Contract

## Status

Draft

## Purpose

This document describes the direct local export worker contract used by DS-065.
The worker sits in front of MinIO and FFmpeg for the V1 local slice while the
Go API export seam remains available for future coordination work.

## Base URL

The browser talks to the export worker through `VITE_EXPORT_BASE_URL`.

For local development the expected value is:

```text
http://localhost:8083
```

The worker is configured through `EXPORT_WORKER_PORT`, `FFMPEG_BINARY`,
`PROCESSING_STALE_AFTER_SECONDS` (default `1800` seconds), and
`FFMPEG_TIMEOUT_SECONDS` (default `1800` seconds).
Local MinIO integration uses `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`,
`S3_SECRET_KEY`, `S3_REGION`, and `S3_FORCE_PATH_STYLE`.

## Readiness

```http
GET /readyz
```

The readiness response must report:

- `service`
- `status`
- `storage`
- `ffmpeg`
- `message`

Example healthy response:

```json
{
  "status": "ok",
  "service": "export-worker",
  "storage": "ready",
  "ffmpeg": "available",
  "message": null
}
```

Example degraded response:

```json
{
  "status": "degraded",
  "service": "export-worker",
  "storage": "ready",
  "ffmpeg": "unavailable",
  "message": "FFmpeg binary not found"
}
```

## Create export

```http
POST /api/exports
```

Request body:

```json
{
  "recordingId": "recording-123",
  "uploadId": "upload-123",
  "sessionId": "session-123",
  "participantId": "participant-123",
  "role": "host",
  "target": {
    "format": "mp4",
    "resolution": "1920x1080"
  }
}
```

Behavior:

- creates the primary export manifest if needed
- is idempotent for a recording
- returns the current manifest for the recording on every call
- starts background export work with a local `tokio::spawn` orchestration in V1
- returns `202 Accepted` with `status: processing` when work was started or restarted
- returns `200 OK` with `status: processing` when a recent matching export is already running
- returns `200 OK` when the export is already `ready`
- restarts stale `processing` or `pending` manifests when `updatedAt` is older than `PROCESSING_STALE_AFTER_SECONDS`
- restarts `failed` manifests on the next matching `POST`
- assigns a new `attemptId` on each new or restarted processing attempt
- only lets the current `attemptId` write terminal `ready` or `failed` states
- stores final MP4 artifacts under attempt-scoped object keys
- validates the source upload in the background before rendering
- sorts uploaded chunks by numeric `chunkIndex` before reconstruction
- rejects uploads with missing chunks, duplicate chunk indexes, failed chunk statuses, invalid byte counts, or checksum mismatches
- applies an FFmpeg timeout using `FFMPEG_TIMEOUT_SECONDS`
- captures FFmpeg stderr on failure, truncates the stored summary, and persists the error on the export manifest
- streams the final MP4 into MinIO and persists the export manifest

Artifact note:

- Export artifacts are attempt-scoped to prevent stale background jobs from overwriting a newer successful export artifact.
- The current manifest `outputObjectKey` is the source of truth for download.

Status summary:

- `202 Accepted`: new export work started
- `202 Accepted`: stale or failed export was restarted
- `200 OK`: current export already `processing`
- `200 OK`: current export already `ready`
- `400 Bad Request`: request payload or target is invalid
- `409 Conflict`: request identifiers do not match the existing primary export for the recording
- `422 Unprocessable Entity`: export processing failed, including FFmpeg failures

Response fields:

- `exportId`
- `attemptId`
- `recordingId`
- `uploadId`
- `sessionId`
- `participantId`
- `role`
- `status`
- `targetFormat`
- `targetResolution`
- `sourceManifestKey`
- `outputObjectKey`
- `outputBytes`
- `createdAt`
- `updatedAt`
- `completedAt`
- `error`

## Inspect export

```http
GET /api/exports/{exportId}
```

Responses:

- `200 OK` when the manifest exists
- `404 Not Found` when the export is unknown
- the returned manifest can move through `processing`, `ready`, or `failed`

## Download export

```http
GET /api/exports/{exportId}/download
```

Responses:

- `200 OK` with `video/mp4` and `Content-Disposition: attachment` when the export is ready
- `409 Conflict` when the export is not finished yet
- `404 Not Found` when the export is unknown
- the worker streams the MP4 response body instead of buffering the whole file in memory

## Storage layout

The V1 local worker stores assets in MinIO with these keys:

- upload manifest: `recordings/{recordingId}/uploads/{uploadId}/manifest.json`
- upload chunks: `sessions/{sessionId}/participants/{participantId}/recordings/{recordingId}/uploads/{uploadId}/chunks/{chunkIndex}`
- export manifest: `exports/{exportId}/manifest.json`
- export output: `sessions/{sessionId}/participants/{participantId}/recordings/{recordingId}/exports/{exportId}/attempts/{attemptId}/output-1080p.mp4`

## Non-goals

This contract does not include:

- queue consumers
- NATS orchestration
- retry policies
- multiple export presets
- the Go API export seam as a runtime dependency for the browser
