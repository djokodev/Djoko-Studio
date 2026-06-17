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
- room presence events are emitted as `room-state`, `peer-joined`, and `peer-left`
- valid `signal` messages are relayed between the two participants in memory
- `PORT` overrides the default listen port
- graceful shutdown and basic HTTP server timeouts

## What is not implemented yet

- in-memory only, with no persistence
- no auth yet
- no full authorization yet
- no media transport or WebRTC negotiation inside the signaling service
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
- joining participants receive an initial `room-state` message
- the existing `signal` relay behavior stays compatible with the presence events

## Presence events

The service sends explicit presence updates so the browser UI can show room state
without guessing from signaling traffic alone.

- `room-state` is sent to the participant that just connected
- `peer-joined` is sent to the already-connected peer when the other participant joins
- `peer-left` is sent to the still-connected peer when the other participant leaves

Each presence message includes the `session_id` and participant metadata so the
frontend can show the peer role and participant ID.

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

## Local host/guest smoke test

Use this flow when you want to verify the local host/guest path end to end.

1. Start PostgreSQL, the API, the signaling service, and the web app.
2. Open the host page and create a session.
3. Start local camera and microphone preview on the host.
4. Open the guest URL in another browser window or private window.
5. Start local camera and microphone preview on the guest.
6. Connect signaling on the host.
7. Connect signaling on the guest.
8. Confirm the host sees `peer-joined` and the guest sees `room-state`.
9. Confirm peer presence shows as connected in both panels.
10. Start WebRTC from the host.
11. Confirm remote media appears once browser permissions allow playback.
12. Optionally send a test data channel message.

Current limits for this smoke test:

- one host and one guest only
- no SFU
- no multi-guest rooms
- no production auth
- no remote recording or export yet
- no upload behavior expected
