# Signaling Service

Minimal Go scaffold for Djoko Studio WebRTC signaling.

## Endpoints

- `GET /healthz`
- `GET /readyz`
- `GET /ws`

## Run

```bash
PORT=8081 go run ./cmd/signaling
```

## Validate

```bash
go test ./...
```
