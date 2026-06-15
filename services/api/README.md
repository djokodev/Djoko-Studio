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

Session and guest join routes are still registered when `DATABASE_URL` is empty, but they return `503 Service Unavailable` with a small JSON error payload because the required stores are not configured.

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

DS-025, DS-026, and DS-027 wire the initial session and guest route surface to the storage seams.

- `POST /v1/sessions` creates a session from JSON input and returns a raw guest invite token once
- `GET /v1/guest/sessions/{invite_token}` looks up one session by hashed guest invite token
- `POST /v1/guest/sessions/{invite_token}/join` hashes the raw invite token, fetches the session, and creates or updates the single guest participant as `joined`
- `GET /v1/sessions/{id}` fetches a single session
- `GET /v1/studios/{studio_id}/sessions` lists sessions for one studio
- handlers return JSON error payloads like `{"error":"message"}`
- handlers are unit-tested with a fake store and do not require PostgreSQL
- `invite_token_hash` is not accepted from public JSON and is never returned in API responses
- the API stores only a SHA-256 hex hash of the generated guest invite token
- request validation currently covers malformed JSON, required fields, unknown JSON fields, and allowed session statuses
- no authentication or authorization is enforced yet for guest join
- guest join does not add WebRTC, signaling, recording, upload, or export behavior
- guest invite token expiry and revocation are not implemented yet
- a missing route segment for `{invite_token}` returns `404`; a whitespace-only token path value is also treated as `404`
- guest join returns `503` when the session store or participant store is unavailable
- migrations remain manual and DS-027 does not change the schema

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
