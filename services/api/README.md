# API Service

This service is the minimal Go HTTP foundation for Djoko Studio / DNA Studio.

It currently provides only the technical scaffold needed for future API work.

## What is implemented

- Go module under `services/api`
- HTTP server with a small internal routing package
- `GET /healthz`
- `GET /readyz`
- `POST /v1/sessions`
- `GET /v1/guest/sessions/{invite_token}`
- `POST /v1/guest/sessions/{invite_token}/join`
- `POST /v1/guest/sessions/{invite_token}/leave`
- `POST /v1/sessions/{session_id}/host/join`
- `POST /v1/sessions/{session_id}/host/leave`
- `POST /v1/sessions/{session_id}/start`
- `POST /v1/sessions/{session_id}/end`
- `GET /v1/sessions/{id}`
- `GET /v1/studios/{studio_id}/sessions`
- optional PostgreSQL connection foundation behind `DATABASE_URL`
- session-oriented domain and storage interfaces under `services/api/internal`
- a PostgreSQL-backed session store foundation targeting the `sessions` table
- a PostgreSQL-backed participant store foundation targeting guest joins in the `participants` table
- server-side guest invite token generation with hash-only storage
- guest participant join/update behavior for the single guest supported in v0.1
- graceful shutdown on interrupt or termination signals
- tests for the health routes, initial session routes, 404 behavior, database foundation, and storage helpers

## What is intentionally not implemented yet

- product logic
- users
- studios
- participant authorization and multi-guest coordination
- recordings
- permissions
- dashboard data
- quotas
- authentication
- repository coverage beyond the initial sessions store
- additional product migrations
- Docker configuration
- external service integration

## Run

```bash
cd services/api
go run ./cmd/api
```

Override the default port with `PORT`:

```bash
cd services/api
PORT=8081 go run ./cmd/api
```

The default port is `8080`.

## Configuration

The API reads the following environment variables:

- `PORT` controls the local API port and defaults to `8080`
- `APP_ENV` controls runtime context for configuration and logging and defaults to `development`
- `DATABASE_URL` optionally opens a PostgreSQL connection pool during startup and may be left empty for local development or CI
- a useful local `DATABASE_URL` example is `postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable`

When `DATABASE_URL` is empty, the API starts without a database connection. `GET /readyz` does not check the database yet.

Session and join routes are still registered when `DATABASE_URL` is empty, but they return `503 Service Unavailable` with a small JSON error payload because the required stores are not configured.
Session lifecycle routes are also registered when `DATABASE_URL` is empty, and they return `503 Service Unavailable` for the same reason.
Guest leave and host leave routes are also registered when `DATABASE_URL` is empty, and they return `503 Service Unavailable` when the required stores are not configured.

## Database migrations

Migration tooling is in place for `services/api`, but migrations are still manual for now.

- the initial schema migration is `services/api/migrations/00001_create_v0_1_core_tables.sql`
- it creates the `users`, `studios`, `sessions`, `participants`, `recordings`, `recording_tracks`, `uploads`, and `exports` tables
- app startup does not run migrations
- `./scripts/validate.sh` does not require PostgreSQL
- `DATABASE_URL` is required only when running migration commands
- use `./services/api/scripts/migrate.sh status`, `up`, and `down` to manage Goose migrations manually
- use the local PostgreSQL example below when testing migrations manually:

```text
postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable
```

Example commands:

```bash
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable" ./services/api/scripts/migrate.sh status
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable" ./services/api/scripts/migrate.sh up
```

DS-024 adds the first repository and storage-layer foundation that reads and writes the `sessions` table without changing app startup behavior.

## Storage layer foundation

DS-024 adds the first Go storage foundation for the API service.

- the new domain and storage packages live under `services/api/internal`
- the first PostgreSQL implementation targets the `sessions` table only
- no HTTP routes are added in DS-024
- application startup behavior is unchanged
- migrations remain manual
- DS-025 is expected to wire this foundation into initial session API routes

## Session routes

DS-025, DS-026, DS-027, DS-028, and DS-029 wire the initial session and participant route surface to the storage seams.

- `POST /v1/sessions` creates a session from JSON input and returns a raw guest invite token once
- `GET /v1/guest/sessions/{invite_token}` looks up one session by hashed guest invite token
- `POST /v1/guest/sessions/{invite_token}/join` hashes the raw invite token, fetches the session, and creates or updates the single guest participant as `joined`
- `POST /v1/guest/sessions/{invite_token}/leave` hashes the raw invite token, fetches the session, and marks the single guest participant as `left`
- `POST /v1/sessions/{session_id}/host/join` fetches the session by ID, verifies that `host_user_id` matches the session host, and creates or updates the host participant as `joined`
- `POST /v1/sessions/{session_id}/host/leave` fetches the session by ID, verifies that `host_user_id` matches the session host, and marks the host participant as `left`
- `POST /v1/sessions/{session_id}/start` fetches the session by ID, verifies that `host_user_id` matches the session host, transitions the session to `live`, and sets `started_at` if needed
- `POST /v1/sessions/{session_id}/end` fetches the session by ID, verifies that `host_user_id` matches the session host, transitions the session to `ended`, and sets `ended_at` if needed
- `GET /v1/sessions/{id}` fetches a single session
- `GET /v1/studios/{studio_id}/sessions` lists sessions for one studio
- handlers return JSON error payloads like `{"error":"message"}`
- handlers are unit-tested with a fake store and do not require PostgreSQL
- `invite_token_hash` is not accepted from public JSON and is never returned in API responses
- the API stores only a SHA-256 hex hash of the generated guest invite token
- request validation currently covers malformed JSON, required fields, unknown JSON fields, and allowed session statuses
- no authentication or full authorization is enforced yet for host or guest join
- no authentication or full authorization is enforced yet for session lifecycle transitions
- host join does not add WebRTC, signaling, recording, upload, or export behavior
- host join does not create any new account or auth flow
- `host_user_id` must match the session host user ID or the API returns `403`
- lifecycle routes also require `host_user_id` to match the session host user ID or the API returns `403`
- host leave also requires `host_user_id` to match the session host user ID or the API returns `403`
- no authentication or full authorization is enforced yet for guest leave or host leave
- guest leave and host leave do not add WebRTC, signaling, recording, upload, or export behavior
- guest invite token expiry and revocation are not implemented yet
- a missing route segment for `{invite_token}` returns `404`; a whitespace-only token path value is also treated as `404`
- guest join returns `503` when the session store or participant store is unavailable
- guest leave returns `503` when the session store or participant store is unavailable
- host join returns `503` when the session store or participant store is unavailable
- host leave returns `503` when the session store or participant store is unavailable
- lifecycle routes return `503` when the session store is unavailable
- migrations remain manual and DS-027/DS-028/DS-029 do not change the schema

Example host join request:

```json
{
  "host_user_id": "3c9abfe7-3133-4924-b159-f62277dfce7c",
  "display_name": "Host Name"
}
```

Example session start request:

```json
{
  "host_user_id": "3c9abfe7-3133-4924-b159-f62277dfce7c"
}
```

Example session start response:

```json
{
  "session": {
    "id": "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
    "studio_id": "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
    "host_user_id": "3c9abfe7-3133-4924-b159-f62277dfce7c",
    "title": "Interview with guest",
    "status": "live",
    "started_at": "2026-06-15T20:05:00Z",
    "created_at": "2026-06-15T20:00:00Z",
    "updated_at": "2026-06-15T20:05:00Z"
  }
}
```

Example session end request:

```json
{
  "host_user_id": "3c9abfe7-3133-4924-b159-f62277dfce7c"
}
```

Example session end response:

```json
{
  "session": {
    "id": "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
    "studio_id": "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
    "host_user_id": "3c9abfe7-3133-4924-b159-f62277dfce7c",
    "title": "Interview with guest",
    "status": "ended",
    "started_at": "2026-06-15T20:05:00Z",
    "ended_at": "2026-06-15T20:45:00Z",
    "created_at": "2026-06-15T20:00:00Z",
    "updated_at": "2026-06-15T20:45:00Z"
  }
}
```

Example host join response:

```json
{
  "session": {
    "id": "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
    "studio_id": "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
    "host_user_id": "3c9abfe7-3133-4924-b159-f62277dfce7c",
    "title": "Interview with guest",
    "status": "draft",
    "created_at": "2026-06-15T20:00:00Z",
    "updated_at": "2026-06-15T20:02:00Z"
  },
  "participant": {
    "id": "5d0cf5cb-b436-4e48-af38-df557dc519fe",
    "session_id": "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
    "role": "host",
    "display_name": "Host Name",
    "status": "joined",
    "joined_at": "2026-06-15T20:03:00Z",
    "created_at": "2026-06-15T20:00:00Z",
    "updated_at": "2026-06-15T20:02:00Z"
  }
}
```

Example guest leave request:

```json
{}
```

Example guest leave response:

```json
{
  "session": {
    "id": "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
    "studio_id": "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
    "host_user_id": "3c9abfe7-3133-4924-b159-f62277dfce7c",
    "title": "Interview with guest",
    "status": "live",
    "created_at": "2026-06-15T20:00:00Z",
    "updated_at": "2026-06-15T20:08:00Z"
  },
  "participant": {
    "id": "5d0cf5cb-b436-4e48-af38-df557dc519fe",
    "session_id": "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
    "role": "guest",
    "display_name": "Guest Name",
    "status": "left",
    "left_at": "2026-06-15T20:07:00Z",
    "created_at": "2026-06-15T20:03:00Z",
    "updated_at": "2026-06-15T20:08:00Z"
  }
}
```

Example host leave request:

```json
{
  "host_user_id": "3c9abfe7-3133-4924-b159-f62277dfce7c"
}
```

Example host leave response:

```json
{
  "session": {
    "id": "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
    "studio_id": "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
    "host_user_id": "3c9abfe7-3133-4924-b159-f62277dfce7c",
    "title": "Interview with guest",
    "status": "live",
    "created_at": "2026-06-15T20:00:00Z",
    "updated_at": "2026-06-15T20:08:00Z"
  },
  "participant": {
    "id": "5d0cf5cb-b436-4e48-af38-df557dc519fe",
    "session_id": "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
    "role": "host",
    "display_name": "Host Name",
    "status": "left",
    "left_at": "2026-06-15T20:08:00Z",
    "created_at": "2026-06-15T20:03:00Z",
    "updated_at": "2026-06-15T20:08:00Z"
  }
}
```

Example create request:

```json
{
  "studio_id": "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
  "host_user_id": "3c9abfe7-3133-4924-b159-f62277dfce7c",
  "title": "Interview with guest",
  "status": "draft",
  "scheduled_at": "2026-01-15T10:00:00Z"
}
```

Example create response:

```json
{
  "session": {
    "id": "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
    "studio_id": "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
    "host_user_id": "3c9abfe7-3133-4924-b159-f62277dfce7c",
    "title": "Interview with guest",
    "status": "draft",
    "scheduled_at": "2026-01-15T10:00:00Z",
    "created_at": "2026-06-15T20:00:00Z",
    "updated_at": "2026-06-15T20:02:00Z"
  },
  "guest_invite_token": "raw-token-returned-once"
}
```

Example guest join request:

```json
{
  "display_name": "Guest Name"
}
```

Example guest join response:

```json
{
  "session": {
    "id": "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
    "studio_id": "2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d",
    "host_user_id": "3c9abfe7-3133-4924-b159-f62277dfce7c",
    "title": "Interview with guest",
    "status": "draft",
    "created_at": "2026-06-15T20:00:00Z",
    "updated_at": "2026-06-15T20:02:00Z"
  },
  "participant": {
    "id": "5d0cf5cb-b436-4e48-af38-df557dc519fe",
    "session_id": "0f1ecf7c-5444-492d-a7a1-31172609a4fa",
    "role": "guest",
    "display_name": "Guest Name",
    "status": "joined",
    "joined_at": "2026-06-15T20:03:00Z",
    "created_at": "2026-06-15T20:00:00Z",
    "updated_at": "2026-06-15T20:02:00Z"
  }
}
```

## Test

```bash
cd services/api
go test ./...
```

## Health endpoints

Once the server is running, call:

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
```

Both endpoints return JSON similar to:

```json
{
  "status": "ok",
  "service": "api"
}
```
