# API Service

This service is the minimal Go HTTP foundation for Djoko Studio / DNA Studio.

It currently provides only the technical scaffold needed for future API work.

## What is implemented

- Go module under `services/api`
- HTTP server with a small internal routing package
- `GET /healthz`
- `GET /readyz`
- graceful shutdown on interrupt or termination signals
- tests for the basic routes and 404 behavior

## What is intentionally not implemented yet

- product logic
- users
- studios
- sessions
- participants
- recordings
- permissions
- dashboard data
- quotas
- authentication
- database access
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
- `DATABASE_URL` is reserved for future database integration, is stored in config for now, and is not used to connect yet

Database access will be added in a later task.

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
