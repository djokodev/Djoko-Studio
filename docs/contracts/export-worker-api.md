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

The worker is configured through `EXPORT_WORKER_PORT` and `FFMPEG_BINARY`.
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
- returns `409 Conflict` when a matching export is already processing
- validates that the source upload is complete before rendering
- sorts uploaded chunks by numeric `chunkIndex` before reconstruction
- rejects uploads with missing chunks, duplicate chunk indexes, failed chunk statuses, invalid byte counts, or checksum mismatches
- streams the final MP4 into MinIO and persists the export manifest

Response fields:

- `exportId`
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
- export output: `sessions/{sessionId}/participants/{participantId}/recordings/{recordingId}/exports/{exportId}/output-1080p.mp4`

## Non-goals

This contract does not include:

- queue consumers
- retry policies
- multiple export presets
- the Go API export seam as a runtime dependency for the browser
