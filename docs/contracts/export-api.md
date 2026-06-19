# Export API Contract

## Status

Draft

## Purpose

This document describes the minimal export API for Djoko Studio v0.1.

The contract exposes the current export row for a recording and lets the API
create the primary export record exactly once. Rendering itself remains a later
worker concern.

DS-065 uses the Rust export worker directly from the web studio for local
processing and download. The Go API export seam is the durable product/domain
foundation for later worker/job orchestration, not the browser runtime path in
this slice.

## Base URL

The browser and local tooling talk to the API through the existing API base URL.
The endpoints below live under `services/api`.

## Export lifecycle

The API uses a small explicit export status model:

- `pending`
- `processing`
- `ready`
- `failed`

The export row is the source of truth for the current export state. A `failed`
export may include `last_error` so the failure is explainable.

## Endpoints

### Get the current export

```http
GET /v1/recordings/{recording_id}/export
```

Responses:

- `200 OK` when the export row exists
- `404 Not Found` when the export row does not exist
- `503 Service Unavailable` when the export store is not configured

Example response:

```json
{
  "id": "exp_123",
  "recording_id": "rec_123",
  "status": "failed",
  "format": "mp4",
  "width": 1920,
  "height": 1080,
  "storage_object_key": "exports/rec_123/final.mp4",
  "byte_size": 12345678,
  "duration_ms": 456789,
  "last_error": "FFmpeg exited with code 1",
  "created_at": "2026-06-19T10:00:00Z",
  "updated_at": "2026-06-19T10:15:00Z",
  "completed_at": "2026-06-19T10:15:00Z"
}
```

### Create the primary export row

```http
POST /v1/recordings/{recording_id}/export
```

Behavior:

- creates the export row if it does not exist
- returns the existing export row if it already exists
- returns `201 Created` on first creation
- returns `200 OK` on later idempotent calls
- returns `404 Not Found` when the source recording does not exist
- returns `503 Service Unavailable` when the export store is not configured

The request body is intentionally empty in this slice.

## Storage contract

The backend persists exports in PostgreSQL using the existing `exports` table.
The current v0.1 row shape includes:

- `recording_id`
- `status`
- `format`
- `width`
- `height`
- `storage_object_key`
- `byte_size`
- `duration_ms`
- `last_error`
- `completed_at`

`last_error` is nullable and is used only when the export is in `failed`.

## Non-goals

This contract does not include:

- FFmpeg orchestration
- queue or event consumption
- export retries
- public download URLs
- export UI
- multiple export presets
