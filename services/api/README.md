# API Service

This service is the minimal Go HTTP foundation for Djoko Studio / DNA Studio.

It currently provides only the technical scaffold needed for future API work.

## What is implemented

- Go module under `services/api`
- HTTP server with a small internal routing package
- `GET /healthz`
- `GET /readyz`
- optional PostgreSQL connection foundation behind `DATABASE_URL`
- session-oriented domain and storage interfaces under `services/api/internal`
- a PostgreSQL-backed session store foundation targeting the `sessions` table
- graceful shutdown on interrupt or termination signals
- tests for the basic routes, 404 behavior, database foundation, and storage helpers

## What is intentionally not implemented yet

- product logic
- users
- studios
- session HTTP routes
- participants
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
