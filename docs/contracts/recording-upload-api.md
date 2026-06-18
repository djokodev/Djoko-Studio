# Recording Upload API Contract

## Status

Implemented

## Purpose

This document describes the resumable upload API used by the browser recording
queue and the Rust `services/upload` backend.

The browser keeps the local recording copy until the server confirms completion.
Upload state is tracked separately from local recording persistence so a refresh
can resume from the last confirmed chunk without rebuilding the full recording
Blob.

Chunks may vary in size. MediaRecorder output is not guaranteed to be uniform,
so the protocol treats `chunkSizeBytes` on session creation as a nominal hint,
while each uploaded chunk carries its own actual `chunkSizeBytes` header.

## Base URL

The browser talks to the upload service through `VITE_UPLOAD_BASE_URL`.

If the variable is not set, the frontend falls back to:

```text
http://localhost:8082
```

## JSON shape

The API uses camelCase JSON fields.

Statuses are string enums:

- session statuses: `initializing`, `ready`, `uploading`, `paused`,
  `incomplete`, `uploaded`, `failed`, `canceled`
- chunk statuses: `pending`, `uploaded`, `already_present`, `failed`,
  `rejected`

Error responses use this envelope:

```json
{
  "error": {
    "code": "invalid_metadata",
    "message": "Header x-dna-total-bytes is required.",
    "retryable": false
  }
}
```

## Endpoints

### Create upload session

```http
POST /api/recordings/{recordingId}/uploads
```

Request body:

```json
{
  "recordingId": "rec_123",
  "sessionId": "session_123",
  "participantId": "participant_123",
  "role": "host",
  "totalBytes": 12345678,
  "expectedChunkCount": 12,
  "chunkSizeBytes": 1048576,
  "mimeType": "video/webm",
  "manifestVersion": 1,
  "clientCreatedAt": "2026-06-17T00:00:00.000Z"
}
```

`chunkSizeBytes` in the create request is a nominal size hint. It does not
promise that every chunk will use the same size.

Response body:

```json
{
  "recordingId": "rec_123",
  "sessionId": "session_123",
  "participantId": "participant_123",
  "role": "host",
  "uploadId": "upl_abc123",
  "status": "ready",
  "acceptedChunkSizeBytes": 1048576,
  "expectedChunkCount": 12,
  "uploadedChunkCount": 0,
  "totalBytes": 12345678,
  "uploadedBytes": 0,
  "missingChunkIndexes": [0, 1, 2],
  "rejectedChunkIndexes": [],
  "updatedAt": "2026-06-17T00:00:00.000Z",
  "expiresAt": "2026-06-18T00:00:00.000Z"
}
```

Validation rules:

- `recordingId`, `sessionId`, and `participantId` are required
- `totalBytes` must be greater than zero
- `chunkSizeBytes` must be greater than zero
- `expectedChunkCount` must be greater than zero
- `manifestVersion` must be `1`

### Get upload status

```http
GET /api/recordings/{recordingId}/uploads/{uploadId}
```

Response body:

```json
{
  "recordingId": "rec_123",
  "sessionId": "session_123",
  "participantId": "participant_123",
  "role": "host",
  "uploadId": "upl_abc123",
  "status": "uploading",
  "expectedChunkCount": 12,
  "uploadedChunkCount": 9,
  "totalBytes": 12345678,
  "uploadedBytes": 9437184,
  "missingChunkIndexes": [9, 10, 11],
  "rejectedChunkIndexes": [],
  "updatedAt": "2026-06-17T12:34:56.000Z",
  "completedAt": null
}
```

### Upload one chunk

```http
PUT /api/recordings/{recordingId}/uploads/{uploadId}/chunks/{chunkIndex}
```

Required headers:

- `Content-Type`
- `X-DNA-Total-Bytes`
- `X-DNA-Chunk-Size`
- `X-DNA-Idempotency-Key`

Optional headers:

- `X-DNA-Chunk-Checksum`

Response body:

```json
{
  "recordingId": "rec_123",
  "uploadId": "upl_abc123",
  "chunkIndex": 0,
  "status": "uploaded",
  "uploadedBytes": 1048576,
  "alreadyPresent": false,
  "uploadedChunkCount": 1,
  "missingChunkIndexes": [1, 2],
  "rejectedChunkIndexes": [],
  "updatedAt": "2026-06-17T12:35:00.000Z"
}
```

Behavior:

- the service stores each chunk independently
- each chunk may be a different size, and the final chunk may be smaller than
  the others
- repeat uploads with the same content are idempotent
- duplicate uploads with the same checksum are reported as
  `already_present`
- checksum mismatches are rejected

### Complete upload

```http
POST /api/recordings/{recordingId}/uploads/{uploadId}/complete
```

Response body:

```json
{
  "recordingId": "rec_123",
  "sessionId": "session_123",
  "participantId": "participant_123",
  "role": "host",
  "uploadId": "upl_abc123",
  "status": "uploaded",
  "complete": true,
  "missingChunkIndexes": [],
  "rejectedChunkIndexes": [],
  "uploadedChunkCount": 12,
  "uploadedBytes": 12345678,
  "updatedAt": "2026-06-17T12:36:00.000Z"
}
```

If chunks are missing or rejected, the service returns `incomplete` and `complete: false`.
The backend finalizes only when every expected chunk is present and the sum of
stored chunk bytes matches `totalBytes`.

### Cancel upload

```http
POST /api/recordings/{recordingId}/uploads/{uploadId}/cancel
```

Response body:

```json
{
  "recordingId": "rec_123",
  "sessionId": "session_123",
  "participantId": "participant_123",
  "role": "host",
  "uploadId": "upl_abc123",
  "status": "canceled",
  "complete": false,
  "updatedAt": "2026-06-17T12:36:30.000Z"
}
```

## Storage contract

The backend stores durable upload state in S3-compatible object storage.

Manifest objects live at:

```text
recordings/{recordingId}/uploads/{uploadId}/manifest.json
```

Chunk objects live at:

```text
sessions/{sessionId}/participants/{participantId}/recordings/{recordingId}/uploads/{uploadId}/chunks/{chunkIndex}
```

## Readiness

`GET /readyz` returns `200` when storage is configured and reachable.

It returns `503` with a descriptive message when the S3/MinIO configuration is
missing or cannot be initialized.
