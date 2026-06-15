# Signaling Service

This service is the minimal Go foundation for Djoko Studio WebRTC signaling.
It exists to prove the service boundary, HTTP health checks, and a basic WebSocket
connection flow before any real signaling logic is added.

## What is implemented

- `GET /healthz` returns an `ok` JSON payload
- `GET /readyz` returns an `ok` JSON payload
- `GET /ws` accepts a WebSocket connection
- `GET /ws` sends a welcome JSON message
- `GET /ws` echoes incoming text messages as JSON
- `PORT` overrides the default listen port
- graceful shutdown and basic HTTP server timeouts

## What is not implemented yet

- WebRTC offer/answer exchange
- ICE candidate handling
- rooms
- host and guest presence
- reconnect coordination
- auth
- database access
- NATS or other messaging integration
- Dockerfile changes
- Docker Compose changes

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
websocat ws://localhost:8081/ws
```

or:

```bash
npx wscat -c ws://localhost:8081/ws
```

`websocat` and `wscat` are optional manual testing tools. They are not project dependencies.
