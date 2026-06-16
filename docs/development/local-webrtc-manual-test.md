# Local WebRTC Manual Test

## Purpose

This guide documents the local end-to-end manual check for the DS-035 WebRTC foundation.

The test is intentionally data-channel-only. It is meant to verify the full local path:

- host session creation
- guest session join
- API session lookup and join flow
- signaling WebSocket connection
- WebRTC offer/answer exchange
- ICE candidate exchange
- test data channel open and message delivery

## What DS-035 Already Supports

DS-035 already gives the web studio:

- a host `RTCPeerConnection`
- host offer creation and signaling relay
- guest answer creation and signaling relay
- ICE candidate exchange through signaling
- a test data channel
- UI state for `connectionState`, `iceConnectionState`, `signalingState`, `dataChannelState`, and event logs
- optional ICE server configuration through `VITE_RTC_ICE_SERVERS_JSON`

## What Is Not Supported Yet

This test does not include:

- camera access
- microphone access
- `getUserMedia`
- media tracks
- recording
- upload
- export
- auth

## Local Services

To run the full manual test locally, you need:

- PostgreSQL, because the API session create/join flow returns `503` without `DATABASE_URL`
- the API service on port `8080`
- the signaling service on port `8081`
- the web studio on port `5173`

Optional but useful for richer ICE testing:

- coturn or another TURN/STUN endpoint

If you already have a local PostgreSQL instance running, use it. Otherwise, the repository already includes local infra tooling in `infra/local`.

## Seed Data

The default host form uses a fixed demo user and studio ID. The local seed script inserts or refreshes these rows:

- user id `3c9abfe7-3133-4924-b159-f62277dfce7c`
- studio id `2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d`

Run it from the repository root:

```bash
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable" ./services/api/scripts/seed-local-webrtc.sh
```

If you use a different local demo user or studio, update the host form values to match valid rows in your database.

## Environment Variables

Recommended local values:

```bash
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable"
VITE_API_BASE_URL=http://localhost:8080
VITE_SIGNALING_BASE_URL=ws://localhost:8081
```

Optional ICE server config for the browser:

```bash
VITE_RTC_ICE_SERVERS_JSON='[{"urls":"stun:stun.l.google.com:19302"}]'
```

If `VITE_RTC_ICE_SERVERS_JSON` is omitted, the app uses an empty custom ICE server list.

## Start Local Services

1. Start PostgreSQL with the existing local infra.

```bash
cd infra/local
cp .env.example .env
docker compose up -d postgres
```

If you want the full local infra stack, run:

```bash
cd infra/local
docker compose up -d
```

2. Apply the API migrations if the database is empty.

```bash
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable" \
  ./services/api/scripts/migrate.sh up
```

3. Seed the local WebRTC demo rows.

```bash
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable" \
  ./services/api/scripts/seed-local-webrtc.sh
```

4. Start the API service.

```bash
cd services/api
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable" \
  go run ./cmd/api
```

5. Start the signaling service.

```bash
cd services/signaling
go run ./cmd/signaling
```

6. Start the web studio.

```bash
cd apps/web-studio
VITE_API_BASE_URL=http://localhost:8080 \
VITE_SIGNALING_BASE_URL=ws://localhost:8081 \
VITE_RTC_ICE_SERVERS_JSON='[{"urls":"stun:stun.l.google.com:19302"}]' \
npm run dev
```

If you do not want a custom ICE server during local testing, omit `VITE_RTC_ICE_SERVERS_JSON`.

## Manual Browser Flow

7. Open `http://localhost:5173` in one browser window.
8. Fill in the host form and create a session.
9. On the host page, open the signaling panel and click `Connect signaling`.
10. Keep the host page open.
11. Open the guest invite URL from the host session summary in a second browser window or private window.
12. Join the guest session.
13. On the guest page, click `Connect signaling`.
14. On the host page, click `Create peer connection / Start WebRTC test`.
15. Watch the host and guest logs for the offer, answer, and ICE exchange.
16. When the data channel opens, send a test message from the host.
17. If both sides show an open data channel, send a message from the guest too.

## Expected Success States

On a successful run, you should see:

- the signaling WebSocket connected on both sides
- `connectionState` move into a connected or completed state
- `iceConnectionState` move into a connected or completed state
- `signalingState` return to `stable`
- `dataChannelState` change to `open`
- `Peer connection exists` show `yes`
- `Local description` show `set`
- `Remote description` show `set`
- logs for offer creation, offer send, answer creation, answer send, ICE generation, ICE send, data channel open, and test message delivery

## Common Failure Cases

- Signaling not connected: click `Connect signaling` first or verify `VITE_SIGNALING_BASE_URL`.
- Host opened without guest: the host should wait for the guest answer and ICE candidates.
- Guest opened before host: this is normal; the guest should wait for the host offer.
- ICE stuck on `checking`: the WebRTC peers are exchanging signaling, but connectivity is not completing. Check ICE server config, local network rules, and browser diagnostics.
- Data channel not open: the negotiation is not finished yet, or one side failed to apply the remote description.
- Invalid `VITE_RTC_ICE_SERVERS_JSON`: the panel shows a parse error and falls back to `[]`.
- Wrong API URL: host create or guest join fails before signaling starts.
- Wrong signaling URL: the signaling WebSocket never reaches `Connected`.

## Browser DevTools Checks

- Check the console for WebRTC or signaling errors.
- Check the Network tab for the signaling WebSocket and its frames.
- Use `chrome://webrtc-internals` in Chromium-based browsers, or the equivalent browser diagnostics, to inspect the peer connection state transitions and ICE candidate flow.

## Scope Reminder

This guide is for the data-channel-only WebRTC foundation.

Camera and microphone preview are intentionally deferred to a later task.
