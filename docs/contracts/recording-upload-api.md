# Recording Upload API Contract Draft

## Status

Draft

## Purpose

This document defines the future resumable upload API for browser-recorded media.
It is intentionally documentation-first and does not describe an implemented
backend yet.

The upload flow supports a browser local recording after, or while, that
recording still exists locally. The browser-local copy remains the source of
truth until the server confirms that the upload is complete. This preserves the
local-first safety model established by the recording architecture and upload
queue design.

## Scope

This draft covers:

- upload session creation
- upload session status lookup
- chunk upload
- upload completion
- upload cancellation
- draft validation and error responses

This draft does not cover:

- backend implementation details
- storage layout
- authentication rules
- UI behavior
- transport retries in code
- final OpenAPI generation

## Core concepts

### `recordingId`

The stable identifier for a browser recording. It identifies the local recording
source and the upload session family for that recording.

### `uploadId`

The server-issued identifier for a resumable upload session. A single
`recordingId` may create one or more upload sessions over time, but each active
session has one `uploadId`.

### `chunkIndex`

The zero-based chunk number for a recording upload.

The contract treats each `chunkIndex` as mapping to exactly one byte range.
Chunk indexes must be stable and deterministic so retries can safely target the
same data.

### `chunkSizeBytes`

The nominal byte size used for chunking the recording. Every chunk except the
last chunk should match this size unless the server explicitly accepts a
different size policy.

### `totalBytes`

The full byte size of the local recording source for the upload session.

### `expectedChunkCount`

The number of chunks the client expects to upload for `totalBytes` at the chosen
`chunkSizeBytes`.

In the common case:

`expectedChunkCount = ceil(totalBytes / chunkSizeBytes)`

### `uploadedChunkCount`

The number of chunks the server considers accepted for a session. This includes
chunks accepted as `uploaded` and chunks reported as `already_present`.

### Upload status

The coarse-grained status for the upload session itself.

### Chunk status

The status of one chunk within an upload session.

### Idempotency

The property that retries do not duplicate work or corrupt data. Repeating the
same create, chunk upload, status check, completion, or cancellation action
should be safe when the request metadata matches the existing session state.

### Local-first safety copy

The local browser recording remains the safety copy until the server confirms
completion. The upload contract must not imply that server durability replaces
the local recording before that confirmation.

## Status model

The future server-side upload session status model is aligned with the frontend
state model in `apps/web-studio/src/upload/recordingUploadState.ts`.

### Session statuses

- `initializing` - the upload session is being created or negotiated
- `ready` - the server accepted the session and chunk uploads may begin
- `uploading` - one or more chunks are in flight or have been accepted
- `paused` - the session is intentionally paused and may resume later
- `incomplete` - the session exists but is missing chunks or has unresolved
  validation failures
- `uploaded` - the server has verified completion
- `failed` - the session cannot continue without a new attempt or manual fix
- `canceled` - the session was canceled and should not continue

The frontend also uses two client-only transitional concepts:

- `not_started` - no upload session has been created yet
- `retrying` - the client is preparing to retry after a recoverable failure

Those two states are useful in the browser state machine but are not required as
server response statuses.

### Chunk statuses

- `pending` - the chunk has not been uploaded yet
- `uploaded` - the server stored the chunk for the first time
- `already_present` - the server already had the same chunk and treated the
  request as idempotent
- `failed` - the chunk upload failed in a retryable or temporary way
- `rejected` - the chunk was permanently rejected because validation failed

The frontend state model currently includes an internal `uploading` chunk status
for in-flight local bookkeeping. That status is client-side only and is not a
required server response.

## Upload lifecycle

### 1. Local recording exists

- the recording is present in browser-local storage
- chunk metadata and session metadata may already exist locally
- the browser remains the source of truth

### 2. Upload session is created

- the client sends the recording metadata
- the server validates the upload contract inputs
- the server returns an `uploadId` and the accepted upload policy

### 3. Chunks are uploaded

- the client uploads chunks one at a time
- each request identifies one `chunkIndex`
- the server accepts, deduplicates, or rejects the chunk

### 4. Upload status is queried

- the client can ask the server which chunks are missing or rejected
- the response is used to resume after interruption or refresh

### 5. Upload completion is requested

- the client asks the server to verify the full session
- the server checks chunk count, byte count, and metadata consistency
- the server only marks the session `uploaded` when verification succeeds

### 6. Upload is canceled

- the client can stop the session explicitly
- canceling does not delete the local browser recording copy

## Endpoint draft

The draft endpoint shape uses the `/api` prefix and recording-scoped upload
resources.

### A. Create upload session

```http
POST /api/recordings/{recordingId}/uploads
```

Recommended request body:

```json
{
  "totalBytes": 123456789,
  "expectedChunkCount": 120,
  "chunkSizeBytes": 1048576,
  "mimeType": "video/webm",
  "manifestVersion": 1,
  "clientCreatedAt": "2026-06-17T00:00:00.000Z"
}
```

Recommended response body:

```json
{
  "recordingId": "rec_...",
  "uploadId": "upl_...",
  "status": "ready",
  "acceptedChunkSizeBytes": 1048576,
  "expiresAt": "2026-06-18T00:00:00.000Z"
}
```

Recommended behavior:

- creating the session should be retry-safe when the same idempotency key is
  used
- the server may return an existing session instead of creating a duplicate one
- the server should validate the total bytes, chunk size, and expected chunk
  count together

### B. Get upload session status

```http
GET /api/recordings/{recordingId}/uploads/{uploadId}
```

Recommended response body:

```json
{
  "recordingId": "rec_...",
  "uploadId": "upl_...",
  "status": "uploading",
  "expectedChunkCount": 120,
  "uploadedChunkCount": 114,
  "totalBytes": 123456789,
  "uploadedBytes": 117440512,
  "missingChunkIndexes": [114, 115, 116, 117, 118, 119],
  "rejectedChunkIndexes": [],
  "updatedAt": "2026-06-17T12:34:56.000Z"
}
```

Recommended behavior:

- the endpoint is read-only
- the response should help the client resume without re-uploading already stored
  chunks
- `missingChunkIndexes` should reflect the current expected chunk range

### C. Upload one chunk

```http
PUT /api/recordings/{recordingId}/uploads/{uploadId}/chunks/{chunkIndex}
```

Recommended headers:

- `Content-Type`
- `Content-Length`
- `X-DNA-Chunk-Index`
- `X-DNA-Chunk-Size`
- `X-DNA-Total-Bytes`
- `X-DNA-Idempotency-Key`
- `X-DNA-Chunk-Checksum` optional, future

Recommended response body:

```json
{
  "recordingId": "rec_...",
  "uploadId": "upl_...",
  "chunkIndex": 0,
  "status": "uploaded",
  "uploadedBytes": 1048576,
  "alreadyPresent": false
}
```

Recommended behavior:

- repeated requests for the same chunk should return `uploaded` or
  `already_present`
- the server must reject mismatched metadata
- the byte range for one `chunkIndex` must be stable for the life of the upload
  session

### D. Complete upload session

```http
POST /api/recordings/{recordingId}/uploads/{uploadId}/complete
```

Recommended response body:

```json
{
  "recordingId": "rec_...",
  "uploadId": "upl_...",
  "status": "uploaded",
  "complete": true,
  "missingChunkIndexes": [],
  "rejectedChunkIndexes": [],
  "updatedAt": "2026-06-17T12:40:00.000Z"
}
```

Recommended behavior:

- the server verifies chunk presence and byte totals before declaring success
- the response should make clear whether the server considers the upload
  complete
- if verification fails, the server should return `complete: false` and a status
  such as `incomplete` or `failed`

### E. Cancel upload session

```http
POST /api/recordings/{recordingId}/uploads/{uploadId}/cancel
```

Recommended response body:

```json
{
  "recordingId": "rec_...",
  "uploadId": "upl_...",
  "status": "canceled",
  "complete": false,
  "updatedAt": "2026-06-17T12:45:00.000Z"
}
```

Recommended behavior:

- cancel should be explicit
- cancel should be idempotent
- cancel should not imply deletion of the browser-local recording

## Idempotency rules

- creating an upload session should be safe to retry when the same idempotency
  key is used
- uploading the same chunk again should not duplicate data
- `chunkIndex` must map to exactly one byte range for a given upload session
- mismatched chunk metadata should be rejected
- retries after network interruption should be safe
- completion should be safe to retry after a timeout or ambiguous network
  failure
- cancellation should be safe to retry

## Validation and error model

The server should use a small JSON error envelope for upload API failures.

Recommended error body:

```json
{
  "error": {
    "code": "chunk_size_mismatch",
    "message": "Chunk size does not match the upload contract.",
    "retryable": false
  }
}
```

Recommended error codes:

- `invalid_recording_id`
- `invalid_upload_id`
- `expired_upload_session`
- `invalid_chunk_index`
- `chunk_size_mismatch`
- `total_bytes_mismatch`
- `checksum_mismatch`
- `upload_already_completed`
- `upload_canceled`
- `unauthorized`
- `payload_too_large`
- `unsupported_media_type`
- `chunk_rejected`
- `session_not_ready`
- `local_recording_missing`

Notes on the error model:

- `local_recording_missing` is primarily a client-side preflight failure because
  the server cannot directly detect that the browser lost its source chunks
- `checksum_mismatch` is reserved for future checksum enforcement
- `unauthorized` is listed for the future auth model and may not be used until
  upload authorization exists

### Suggested retryability guidance

- `invalid_recording_id` - `false`
- `invalid_upload_id` - `false`
- `expired_upload_session` - `false`
- `invalid_chunk_index` - `false`
- `chunk_size_mismatch` - `false`
- `total_bytes_mismatch` - `false`
- `checksum_mismatch` - `false`
- `upload_already_completed` - `false`
- `upload_canceled` - `false`
- `unauthorized` - `false`
- `payload_too_large` - `false`
- `unsupported_media_type` - `false`
- `chunk_rejected` - `false`
- `session_not_ready` - `true` or `false` depending on whether the state is
  temporary
- `local_recording_missing` - `false`

## Client and server alignment

The browser upload state model in
[`apps/web-studio/src/upload/recordingUploadState.ts`](/Users/jeotech/Desktop/projects/Djoko Studio/apps/web-studio/src/upload/recordingUploadState.ts)
already models:

- session lifecycle
- per-chunk lifecycle
- retry metadata
- completion metadata
- local error messages

This API contract should stay compatible with that model so the browser can
reconcile persisted upload state against server responses.

Practical mapping guidance:

- `not_started` maps to the browser before a create-session call
- `initializing` maps to the create-session request in flight
- `ready` maps to an established session waiting for chunk uploads
- `uploading` maps to one or more active or recently accepted chunk uploads
- `paused` maps to an intentionally suspended client queue
- `retrying` maps to a client-side recovery transition
- `incomplete` maps to a session that still needs chunks or reconciliation
- `uploaded` maps to a fully verified server-side upload
- `failed` maps to a session that needs intervention or a new attempt
- `canceled` maps to a terminal canceled session

## Non-goals

- no backend implementation in this document
- no upload UI in this document
- no browser networking implementation in this document
- no storage schema in this document
- no auth policy finalization in this document
- no final checksum mandate in this document
- no automatic deletion of the local recording in this document

## Open questions for later slices

- whether the first upload service implementation should expose OpenAPI from
  this contract
- whether chunk checksums become required or remain optional
- whether the upload service should emit more granular status transition events
- whether `paused` is server-managed, client-managed, or both
- whether upload session expiry should be fixed or negotiated

