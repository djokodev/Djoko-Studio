# Web Studio

`apps/web-studio` is the React + TypeScript + Vite frontend for Djoko Studio.
It now includes the first host-facing session creation flow, the first guest-facing session join flow,
a local camera and microphone preview foundation with local mic/camera toggle controls,
the first local MediaRecorder in-memory prototype for the preview stream,
initial WebRTC media track attachment during negotiation,
and a remote preview foundation with manual remote audio playback controls alongside the
signaling-room connection panel for both roles. It also includes browser recording
capability diagnostics and a local MediaRecorder in-memory prototype with DS-044
state machine diagnostics for future local capture work. DS-047 extends that
prototype with a local recording manifest foundation, a derived session summary,
stronger lifecycle cleanup, and richer local diagnostics for the current page
session. DS-048 adds the first IndexedDB local persistence foundation and recovery
detection for persisted local recordings. DS-049 adds recovered playback preview
from IndexedDB for persisted local recordings in this browser. DS-050 adds a raw
local recording download safety copy for the completed in-memory preview and the
recovered IndexedDB-backed preview.
DS-051 adds local browser storage visibility and a browser-local cleanup control
for persisted recordings. DS-052 adds local recording integrity diagnostics that
compare persisted manifest and chunk metadata with stored `Blob` sizes so the app
can describe whether the local copy looks complete, may be incomplete, or could
not be verified.

The formal browser recording acceptance checklist lives in
[`docs/qa/browser-recording-acceptance-checklist.md`](../../docs/qa/browser-recording-acceptance-checklist.md).

## What this app does

- shows the DNA Studio / Djoko Studio title and short product description
- keeps the existing host session creation screen on the default route
- supports guest join URLs like `http://localhost:5173/guest/{invite_token}`
- reads the invite token from the `/guest/{invite_token}` path segment
- looks up the session with `GET /v1/guest/sessions/{invite_token}`
- lets a guest enter a display name and join with `POST /v1/guest/sessions/{invite_token}/join`
- displays basic session details after lookup
- displays joined participant details after a successful join
- lets the host or guest start and stop a local camera/microphone preview in the browser
- lets the host or guest mute/unmute the microphone and disable/enable the camera while preview is active
- shows simple local media diagnostics for that preview
- shows browser recording capability diagnostics for the active browser and preview stream
- shows a local recording prototype that records only the active preview stream with in-memory chunks
- shows the DS-044 recording state machine through the local prototype controls
- exposes a local recording manifest and session diagnostics panel for the current
  in-memory recording run
- persists the local recording manifest and chunks to IndexedDB when the browser supports it
- detects persisted local recordings on load and lets you discard the local copy
- lets you preview a recovered local copy from IndexedDB after refresh
- lets you download a raw local safety copy from the completed preview or the recovered browser copy
- shows a local browser storage panel with approximate size, persisted chunk count, browser storage estimate, and a clear-all control for persisted local recordings
- shows local recording integrity diagnostics for persisted copies, including manifest/chunk consistency checks, stored `Blob` sizes, missing chunk counts when available, and a local-only recheck action
- pairs with the browser recording acceptance checklist for QA sign-off before resumable upload work
- attaches the active local preview stream during the initial WebRTC negotiation when preview is already running
- shows a minimal signaling panel after host session creation
- shows a minimal signaling panel after guest join
- lets the host start a WebRTC peer connection using the signaling room
- lets the guest answer the host offer and exchange ICE candidates
- exposes a test data channel for small text messages
- renders a remote media preview foundation when WebRTC tracks arrive
- lets the user intentionally enable or mute remote audio after the remote stream arrives
- shows loading and error states for lookup and join

## What is not implemented yet

- auth
- full authorization
- backend/database behavior
- upload
- export
- cloud sync
- recovery routing

The recording diagnostics are present so the app can report browser support and MIME
type readiness before the local recording prototype is used. A separate pure
recording state machine module models the lifecycle and is surfaced in the UI
through the local recording prototype controls. The local MediaRecorder prototype
records only the active local preview stream, stores actual `Blob` chunks in memory
for the current page session, and now assembles a temporary local playback preview
after recording stops. DS-048 adds IndexedDB persistence for the manifest and
chunks, plus local recovery detection when persisted recordings are found in this
browser. DS-049 adds recovered playback preview from IndexedDB so persisted local
recordings can be previewed after refresh. DS-050 adds a local-only raw download
safety copy for both the current stopped preview and the recovered browser copy.
DS-051 adds a browser-local storage summary with approximate usage and cleanup
controls for persisted local recordings. DS-052 adds a local-only integrity check
that compares the manifest and chunk metadata with stored `Blob` sizes without
uploading, exporting, repairing, or calculating a cryptographic checksum. It is
not final render validation.
Uploads, exports, recovery routing, cloud sync, backend/database behavior, and
final render validation are still out of scope.
DS-047 adds a focused manifest model, derived summary fields, and more explicit
lifecycle reset behavior while keeping the recording local-only and memory-backed.
DS-048 layers in browser-local durability and recovery detection while keeping the
playback preview memory-backed.

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
- remind you that local tracks can be attached during the initial WebRTC negotiation when preview is active

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

This is signaling relay plus peer connection foundation only.

No auth.
No full authorization.
No upload/export behavior.

### Local camera and microphone preview

The web app also includes a browser-only local camera and microphone preview for both host and guest pages.
It uses `getUserMedia({ audio: true, video: true })` only for local browser-side preview.
When the preview is already active before WebRTC negotiation starts, the local tracks can be attached to the peer connection.
The microphone and camera controls toggle existing `MediaStreamTrack.enabled` values, so already attached WebRTC senders see the change without renegotiation.
The preview panel also shows recording capability diagnostics for the current browser.
The local recording prototype below starts from the DS-044 state machine, instantiates `MediaRecorder` only after you click `Start local recording`, stores chunks in memory only, and falls back to the browser default MIME type when no supported MIME type is reported.
Those diagnostics do not trigger recording, storage, uploads, or browser prompts on their own.

- click `Start preview` to request `getUserMedia({ audio: true, video: true })`
- click `Stop preview` to stop every local track and clear the preview
- click `Mute microphone` / `Unmute microphone` to toggle the live audio track without replacing it
- click `Disable camera` / `Enable camera` to toggle the live video track without replacing it
- the preview video element is muted and uses `playsInline` to avoid autoplay issues
- if WebRTC starts without an active local preview, the data channel still works but media tracks are not attached in this release

### Local recording prototype

The local recording prototype is intentionally small and browser-only:

- click `Start local recording` to record the active local preview stream
- click `Stop local recording` to stop the current recorder, keep the in-memory chunks for this page session, and build a temporary local playback preview
- click `Download raw local copy` on the completed preview to download the raw browser recording as a local safety copy
- click `Discard local recording / Reset` to clear the in-memory chunks, metadata, preview URL, and persisted local copy when present
- the diagnostics area shows the manifest recording ID, status, source kind, MIME type, chunk counts, byte totals, latest chunk metadata, preview availability, and IndexedDB persistence status
- the local browser storage panel shows approximate size, persisted chunk count, browser storage usage when available, and a clear-all action for persisted recordings
- the recovery area includes a local integrity check that compares persisted manifest and chunk metadata with stored `Blob` sizes, then reports expected chunks, stored chunks, expected size, stored size, missing chunk counts when available, and a last-checked time
- the recovery panel lists persisted local recordings detected in this browser, lets you preview a local copy from IndexedDB, download the raw local copy after it loads, and lets you discard the local copy
- the playback preview is still local-only, memory-backed, and temporary
- recovered playback from IndexedDB is available through the recovery panel
- clear-all only deletes persisted local recordings in this browser and does not affect any backend or cloud copy
- refreshes may still show persisted local recordings in the recovery panel when IndexedDB is available

### WebRTC peer connection foundation

The app uses `RTCPeerConnection` plus a small test data channel to prove the signaling flow and initial media transport foundation.
It can attach the active local preview stream during the first offer/answer negotiation and renders a muted remote preview area when tracks arrive.
Remote audio stays muted by default until the user clicks `Enable remote audio`.

The frontend reads optional ICE server configuration from `VITE_RTC_ICE_SERVERS_JSON`.

If the variable is not set, the app falls back to an empty ICE server list:

```json
[]
```

Example local setup with an optional STUN server:

```bash
cd apps/web-studio
VITE_API_BASE_URL=http://localhost:8080 \
VITE_SIGNALING_BASE_URL=ws://localhost:8081 \
VITE_RTC_ICE_SERVERS_JSON='[{"urls":"stun:stun.l.google.com:19302"}]' \
npm run dev
```

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
