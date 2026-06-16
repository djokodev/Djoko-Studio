# Web Studio

`apps/web-studio` is the React + TypeScript + Vite frontend for Djoko Studio.
It now includes the first host-facing session creation flow, the first guest-facing session join flow,
and a minimal signaling-room connection panel for both roles.

## What this app does

- shows the DNA Studio / Djoko Studio title and short product description
- keeps the existing host session creation screen on the default route
- supports guest join URLs like `http://localhost:5173/guest/{invite_token}`
- reads the invite token from the `/guest/{invite_token}` path segment
- looks up the session with `GET /v1/guest/sessions/{invite_token}`
- lets a guest enter a display name and join with `POST /v1/guest/sessions/{invite_token}/join`
- displays basic session details after lookup
- displays joined participant details after a successful join
- shows a minimal signaling panel after host session creation
- shows a minimal signaling panel after guest join
- shows loading and error states for lookup and join

## What is not implemented yet

- auth
- full authorization
- WebRTC media
- browser recording
- camera or microphone access
- upload
- export

## Signaling

The web app connects to the Go signaling service with a WebSocket room URL shaped like:

```text
ws://localhost:8081/v1/signaling/rooms/{session_id}?participant_id={participant_id}&role={host|guest}
```

The signaling base URL is read from `VITE_SIGNALING_BASE_URL`.

If `VITE_SIGNALING_BASE_URL` is not set, the app falls back to:

```text
ws://localhost:8081
```

The room URL builder encodes the session ID in the path and the participant ID and role in the query string.

### Host signaling panel

After a host creates a session, the page shows a signaling panel that can:

- show the signaling connection status
- connect to the room
- disconnect from the room
- send a small manual test `signal` payload
- display an event log for open, message, error, and close events
- show the current signaling URL and room info
- remind you that camera, microphone, and WebRTC media are not active yet

The host uses the host user ID from the form as the temporary signaling participant ID.

### Guest signaling panel

After a guest successfully joins and the API returns the guest participant, the page shows the same signaling panel for the guest.

The guest uses the joined participant ID returned by the API and connects with `role=guest`.

### Manual relay test

With the API, signaling service, and web app all running locally:

1. Create a host session from the default route.
2. Click `Connect signaling` in the host panel.
3. Open the guest invite URL.
4. Join the guest session.
5. Click `Connect signaling` in the guest panel.
6. Click `Send test signal` in the host panel.
7. Confirm the guest event log shows the message.
8. Click `Send test signal` in the guest panel.
9. Confirm the host event log shows the message.

This is signaling relay only.

No auth.
No full authorization.
No WebRTC media.
No RTCPeerConnection.
No camera or microphone access.
No browser recording.
No upload/export behavior.

## API configuration

The app reads `VITE_API_BASE_URL` from the frontend environment.

If `VITE_API_BASE_URL` is not set, the app falls back to:

```text
http://localhost:8080
```

The API client uses that base URL for host create, guest lookup, and guest join requests.

The app also reads `VITE_SIGNALING_BASE_URL` for the signaling client.

Example local setup:

```bash
cd apps/web-studio
VITE_API_BASE_URL=http://localhost:8080 npm run dev
```

If you do not set the variable, the app still talks to the local API fallback.

To point the app at a different signaling service URL:

```bash
cd apps/web-studio
VITE_SIGNALING_BASE_URL=ws://localhost:8081 npm run dev
```

## Routes

- default route: host session creation screen
- `/guest/{invite_token}`: guest session join screen

## Run the signaling service locally

```bash
cd services/signaling
go run ./cmd/signaling
```

## Install

```bash
cd apps/web-studio
npm install
```

## Run locally

```bash
cd apps/web-studio
npm run dev
```

## Build

```bash
cd apps/web-studio
npm run build
```
