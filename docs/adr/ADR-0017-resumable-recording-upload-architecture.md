# Resumable recording upload architecture

## Status

Proposed

## Date

2026-06-17

## Context

Djoko Studio records locally in the browser first. The current browser recording
foundation already survives refreshes through IndexedDB-backed persistence,
recovery detection, recovered playback previews, and a raw local download safety
copy.

Upload is a later phase and must not be required for local recording to work.
Network conditions are not reliable enough for a single-shot upload model, so
the upload design must be resumable. It must also be idempotent because retries,
page refreshes, and duplicate requests can happen.

Most importantly, the system must preserve the local-first safety model: the
browser should not claim a recording is safely backed up until the server
confirms upload completion.

This architecture is the next step after the browser-local recording and
persistence foundation. It prepares the path for future host and guest track
upload plus export workflows without changing current local recording behavior.

## Decision

Djoko Studio should treat the browser as the source of truth until the server
confirms upload completion.

- Each local recording keeps a stable `recordingId` in the browser.
- Each upload gets a stable `uploadId` or server upload session ID.
- Browser uploads use chunk indexes and byte sizes so chunk ordering and
  validation stay explicit.
- The server accepts chunk uploads idempotently.
- The server can report which chunks are already present for resume and retry
  flows.
- The browser can resume after refresh by reading IndexedDB state for the
  recording and upload session.
- Upload progress state stays separate from recording integrity state.
- Upload completion is only complete after server-side verification of expected
  chunks and expected total bytes.
- Raw local recordings remain downloadable before upload completion.
- The browser does not delete the local copy automatically in the first MVP
  version.

## Implementation note

DS-057 adds the first frontend-only upload metadata persistence adapter
skeleton. It persists upload session and chunk metadata locally, but it does
not add transport, backend, or UI integration yet.
DS-058 hardens that adapter by treating IndexedDB open failures as unavailable
persistence, without adding transport, backend, or UI integration.

## Proposed upload lifecycle

### A. Local recording completed

- the manifest exists
- chunks exist in IndexedDB
- the local integrity check can run
- upload has not started yet

### B. Upload session initialization

The browser sends metadata such as:

- `recordingId`
- session or interview ID, if available
- participant role, if available
- MIME type
- expected chunk count
- expected total bytes
- recording start and stop timestamps, if available

The server returns:

- `uploadId`
- accepted chunk size policy, if applicable
- already uploaded chunks if resuming

### C. Chunk upload

The browser sends each chunk with:

- `uploadId`
- `recordingId`
- `chunkIndex`
- `chunkByteSize`
- chunk `Blob` or request body
- optional client-side metadata

The server response should indicate one of:

- `accepted`
- `already_present`
- `rejected`
- `retryable_error`
- `fatal_error`

### D. Resume after interruption

The browser asks the server for upload status.

The server returns:

- expected chunk count
- received chunk indexes
- missing chunk indexes
- total received bytes
- completion status

The browser uploads only missing chunks.

### E. Completion

The browser calls complete upload.

The server verifies:

- all chunks are present
- chunk count matches expected
- total bytes match expected
- recording metadata matches the upload session

The server returns:

- `complete`
- `incomplete`
- `rejected`

### F. Post-completion

The browser marks the local upload status as uploaded.

The local copy is retained until the user explicitly clears it.

## Browser-side state model

Future browser-side state should distinguish:

- local recording state
- local integrity state
- upload session state
- per-chunk upload state
- retry state
- last server status check
- upload error state

Suggested upload-facing statuses for that future model:

- `not_started`
- `initializing`
- `ready`
- `uploading`
- `paused`
- `retrying`
- `incomplete`
- `uploaded`
- `failed`
- `canceled`

DS-055 adds the first implementation slice for this state model in the browser
as pure TypeScript state, types, and helpers. It does not implement transport,
persistence, queueing, or UI, and it keeps the model metadata-only and
local-first.

DS-056 adds the browser upload queue persistence design that this model builds
on, but it still does not implement browser storage, transport, backend
endpoints, or UI.

DS-054 does not implement this state model yet. It only documents the
architecture for later work.

## Server-side responsibilities

The future upload service should:

- initialize upload sessions
- accept chunks idempotently
- store chunks safely
- report upload status
- complete uploads after verification
- reject mismatched metadata
- avoid duplicate chunks
- preserve enough metadata for later media and export workers

The likely future service is `services/upload/`, but this PR does not create or
change that implementation.

## Storage model

The likely future storage direction is:

- local development may use MinIO or another S3-compatible storage backend
- chunks may be stored under deterministic paths
- the final object layout is not finalized in this ADR
- chunk metadata and upload session metadata will later need database support
- no database schema is implemented in this PR

## API shape proposal

The following API is a non-binding sketch for the future upload service:

- `POST /uploads/init`
- `PUT /uploads/{uploadId}/chunks/{chunkIndex}`
- `GET /uploads/{uploadId}/status`
- `POST /uploads/{uploadId}/complete`
- `POST /uploads/{uploadId}/cancel`

Purpose and expected behavior:

- `POST /uploads/init` creates or resumes an upload session and returns the
  server-side identifiers and current chunk state.
- `PUT /uploads/{uploadId}/chunks/{chunkIndex}` uploads one chunk idempotently
  and lets the server report whether the chunk was accepted or already present.
- `GET /uploads/{uploadId}/status` reports the current upload state and missing
  chunks without mutating the upload.
- `POST /uploads/{uploadId}/complete` asks the server to verify the upload and
  mark it complete only when the expected chunks and bytes are present.
- `POST /uploads/{uploadId}/cancel` stops the upload session without deleting
  the browser's local recording copy.

## Idempotence rules

- uploading the same chunk twice should not corrupt the upload
- the same chunk index with the same size and content can be treated as already
  present
- the same chunk index with a different size should be rejected
- complete upload can be retried safely
- status is read-only
- cancel behavior should be explicit and should not delete the local browser
  copy

## Failure modes

- browser refresh: the browser should reload upload state from IndexedDB and
  resume from the server status
- network offline: the browser should pause or retry without losing local data
- server timeout: the browser should retry safely using the same upload ID
- duplicate chunk request: the server should respond with already present or
  accepted without corrupting state
- missing chunk: the server should report missing chunk indexes during status or
  completion
- mismatched total size: completion should be rejected
- upload session expired: the browser should surface a recoverable failure and
  require a new session if needed
- storage service unavailable: the browser should surface a retryable error and
  keep the local copy intact
- user clears local copy before upload completion: the upload should fail or
  become incomplete because the source chunks are gone
- server reports incomplete after the browser thinks upload is done: the browser
  should reconcile against server status instead of assuming success

## UX principles

- the UI must clearly distinguish a local copy from an uploaded backup
- the UI must not imply cloud or server safety before completion
- progress should show uploaded chunks and bytes
- retry and resume should be understandable to the user
- local download remains the safety fallback
- errors should be actionable

## Security and privacy considerations

- upload URLs and session IDs should not be guessable
- uploaded media is sensitive
- the authorization model is not finalized yet
- local-only flows should not leak media to the server
- later APIs must validate session and participant access

## Non-goals

- no upload implementation in this PR
- no upload UI in this PR
- no backend endpoint in this PR
- no Rust service implementation in this PR
- no database schema in this PR
- no S3 or MinIO integration in this PR
- no export worker in this PR
- no final 1080p render in this PR
- no separate tracks export in this PR
- no cryptographic checksum requirement yet
- no automatic deletion of the local recording after upload

## Consequences

Positive:

- gives the next implementation step a clear contract
- keeps the local-first safety model intact
- reduces the chance that retries or refreshes corrupt upload state
- prepares the codebase for future upload queue and export work

Tradeoffs:

- adds more upfront design before code lands
- some details remain intentionally provisional
- checksum and content-addressing decisions are deferred

## Alternatives considered

- single-shot upload without explicit resume state
- best-effort retry without server-side chunk tracking
- content-addressed upload as the first step

Those options were not chosen because they do not preserve the local-first
safety model as well as an explicit resumable upload session.

## Open questions

- What exact chunk size policy should the first implementation use?
- Should browser-generated chunks be re-chunked before upload?
- Are SHA-256 checksums needed for the MVP upload path?
- What upload session expiration policy should be used?
- What database schema is needed for sessions, uploads, and chunks?
- What authorization model should govern host and guest uploads?
- When can the local copy be cleared safely?
- Should the upload service be Go or Rust first?
- How should upload status connect to the future export worker?

## Recommended next implementation slices

- DS-055 - Add browser upload state model skeleton
- DS-056 - Add upload queue persistence design
- DS-057 - Add frontend upload queue persistence adapter skeleton
- DS-058 - Handle upload persistence IndexedDB open failures gracefully
- DS-059 - Add upload service API contract draft
- DS-060 - Add upload progress UI placeholder
- DS-061 - Add upload session initialization client skeleton
- DS-062 - Add chunk upload client skeleton behind disabled UI

These slices are illustrative only. They are not added to the feature tracker in
this PR.
