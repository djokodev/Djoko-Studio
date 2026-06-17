# Browser upload queue persistence design

## Purpose

This design prepares the next resumable upload slice by defining how browser
upload state will be saved locally and restored after a refresh or interruption.
It keeps the browser local-first while the upload implementation itself remains
future work.

## Current prerequisites

- DS-055 already introduced the browser upload state model skeleton in pure
  TypeScript.
- Local recording persistence already exists for recording manifests and chunk
  durability in IndexedDB.
- Upload is still not implemented.
- The browser remains local-first until the server confirms upload completion.

## Implementation note

DS-057 introduces the first frontend upload queue persistence adapter skeleton
for metadata only. It stores upload session and chunk metadata in IndexedDB,
but it does not store recording `Blob` chunks, it does not store ObjectURLs, it
does not perform network upload, and it is not yet integrated into the
recorder or UI flows.
DS-058 hardens that adapter so IndexedDB open failures behave like persistence
is unavailable, keeping the metadata layer resilient without adding upload
transport, backend, or UI integration.

## Persistence goals

- preserve upload session metadata across refreshes and tab restarts
- preserve per-chunk upload progress metadata without storing media payloads
- allow resume after refresh
- allow retry after network interruption
- distinguish local recording integrity from upload completion
- avoid claiming cloud or server backup until the server confirms completion
- avoid deleting the local recording automatically in the first MVP

## Proposed IndexedDB storage shape

This is a future design only. It is intentionally metadata-only and does not
store upload blobs, ObjectURLs, or transport state.

### `upload_sessions`

Recommended logical key:

- `recordingId`

Recommended fields:

- `recordingId`
- `uploadId` optional
- `status`
- `expectedChunkCount`
- `expectedTotalBytes`
- `uploadedChunkCount`
- `uploadedBytes`
- `createdAt`
- `updatedAt`
- `completedAt` optional
- `errorMessage` optional
- retry metadata

Recommended retry metadata shape:

- `attemptCount`
- `lastAttemptAt`
- `nextRetryAt`
- `lastErrorMessage`

Recommended future indexes:

- `uploadId`
- `status`
- `updatedAt`

### `upload_chunks`

Recommended logical key:

- `recordingId` plus `chunkIndex`

Recommended fields:

- `recordingId`
- `uploadId` optional
- `chunkIndex`
- `expectedBytes`
- `uploadedBytes`
- `status`
- `lastUpdatedAt`
- `errorMessage` optional

Recommended future indexes:

- `recordingId`
- `uploadId`
- `status`

## Relationship to recording persistence

- recording chunks remain in the existing local recording storage
- upload persistence stores metadata and progress only
- upload persistence must not duplicate media `Blob` chunks
- upload persistence must not store ObjectURLs
- upload persistence should reference `recordingId` and `chunkIndex`
- upload completion depends on future server confirmation, not only local
  metadata

## Resume flow

Future browser behavior should follow this order:

1. The app loads.
2. Persisted local recordings are detected.
3. Upload queue metadata is loaded.
4. Server status is checked in a later task.
5. Already uploaded chunks are reconciled.
6. Missing chunks are scheduled for retry.
7. The user can continue the upload later.

The server status check is not implemented in DS-056. DS-056 only defines the
persistence design that future code will read and write.

## Failure states

Expected future handling should cover:

- browser refresh: reload persisted upload metadata and continue from the last
  known progress
- tab close: preserve session metadata so the upload can resume later
- offline or network loss: keep local progress and retry when connectivity
  returns
- chunk rejected by server: mark the chunk failed and preserve the error
  context for retry or cancellation
- mismatched chunk metadata: stop the session from claiming success until the
  mismatch is resolved
- server upload session expired: require a new session or explicit reinitiation
  path
- local recording missing while upload metadata exists: surface an unrecoverable
  source-data problem because the browser no longer has the chunk source
- user cancels upload: stop the queue and keep the local recording intact
- user clears local browser data: treat the queue as lost and require a new
  local recording or fresh upload session

## Non-goals

DS-056 does not include:

- upload networking
- upload UI
- upload queue implementation
- IndexedDB upload adapter implementation
- backend endpoint implementation
- Rust upload service
- DB schema
- S3 or MinIO integration
- final export
- auto deletion of local recordings
- encryption
- checksum or hash implementation

## Future slices

Recommended follow-on sequence after DS-056:

- DS-057 - Add frontend upload queue persistence adapter skeleton
- DS-058 - Handle upload persistence IndexedDB open failures gracefully
- DS-059 - Add upload service API contract draft
- DS-060 - Add upload progress UI placeholder
- DS-061 - Add upload session initialization client skeleton
- DS-062 - Add chunk upload client skeleton behind disabled UI

DS-059 is the upload service API contract draft slice. The later slices begin
with client and UI work after the documentation-first contract is in place.
