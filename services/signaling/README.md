# Signaling Service

This service is the minimal Go foundation for Djoko Studio signaling.
It exists to prove the service boundary, HTTP health checks, and the first
one-host/one-guest room protocol seam before any real WebRTC negotiation is added.

## What is implemented

- `GET /healthz` returns an `ok` JSON payload
- `GET /readyz` returns an `ok` JSON payload
- `GET /v1/signaling/rooms/{session_id}` accepts a WebSocket connection
- query parameters `participant_id` and `role` select the room participant
- roles are limited to `host` and `guest`
- valid `signal` messages are relayed between the two participants in memory
- `PORT` overrides the default listen port
- graceful shutdown and basic HTTP server timeouts

## What is not implemented yet

- in-memory only, with no persistence
- no auth yet
- no full authorization yet
- no frontend/browser WebRTC code
- no WebRTC media behavior yet
- no recording behavior
- no upload/export behavior
- no database dependency
- no Redis or NATS dependency
- Dockerfile changes
- Docker Compose changes

## Room protocol notes

- one session room supports at most one host and one guest
- missing `session_id` returns `400`
- missing `participant_id` returns `400`
- missing `role` returns `400`
- unsupported `role` returns `400`
- non-WebSocket requests return `400`
- invalid JSON message payloads are rejected with a JSON error message and the connection closes
- unsupported message types are rejected with a JSON error message
- if the peer is not connected yet, the sender receives a JSON error message
- duplicate host or guest connections are rejected with a JSON error message

## Run

```bash
cd services/signaling
go test ./...
go run ./cmd/signaling
```

## Override the port

```bash
PORT=8082 go run ./cmd/signaling
```

The default port is `8081`.

## Test

```bash
cd services/signaling
go test ./...
```

## Health checks

```bash
curl http://localhost:8081/healthz
curl http://localhost:8081/readyz
```

## Manual WebSocket test

If you have an optional WebSocket client installed, you can connect to the endpoint manually:

```bash
websocat "ws://localhost:8081/v1/signaling/rooms/session-123?participant_id=participant-host&role=host"
```

or:

```bash
npx wscat -c "ws://localhost:8081/v1/signaling/rooms/session-123?participant_id=participant-host&role=host"
```

`websocat` and `wscat` are optional manual testing tools. They are not project dependencies.
