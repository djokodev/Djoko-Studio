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
