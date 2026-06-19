# Export foundation and lifecycle

## Status

Accepted

## Date

2026-06-19

## Context

Djoko Studio now has durable local recording and resumable upload foundations.
The next missing seams are the primary export record and the local export
worker contract that will render uploaded WebM chunks into the final deliverable.

The codebase needs a small, explicit export model before FFmpeg orchestration or
queue consumption is introduced so the API can expose export state without
coupling the browser or worker layers to rendering details. For the local V1
slice, the browser talks directly to the export worker through
`VITE_EXPORT_BASE_URL` while the Go API keeps the durable export row seam for
future coordination work.

## Decision

v0.1 uses a single primary export per recording.

- export rows are created on demand
- export state is represented explicitly as `pending`, `processing`, `ready`,
  or `failed`
- `failed` exports may store a human-readable `last_error`
- the API can read the current export row and create the primary export row in
  an idempotent way
- the final export target remains MP4 at 1920x1080, 16:9
- the local worker API exposes readiness, export creation, export inspection,
  and download routes directly to the browser for V1
- the export worker stores its manifest and final MP4 in MinIO using the
  existing upload object layout as input and a dedicated export layout as output

## Consequences

- the API can expose export state before rendering exists
- future workers can update a single durable export record instead of inventing
  a separate status side channel
- the browser and worker code can stay decoupled from FFmpeg details
- one export row per recording keeps the MVP simple, but it also means future
  retry and re-render policies need explicit follow-up design
- the V1 direct browser-to-worker path is intentionally local-first and should
  be revisited before production hardening

## Alternatives considered

- keep export state implicit until the worker is implemented
- expose export progress only through worker logs
- allow multiple export rows per recording in v0.1

## Follow-up questions

- Which worker events should transition an export from `pending` to
  `processing`?
- What should the worker surface when FFmpeg succeeds but output validation
  fails?
- When should export retry semantics be introduced?
