# Local WebRTC Manual Test

## Purpose

This guide documents the local end-to-end manual check for the DS-035 WebRTC foundation.
DS-038 adds a browser-only local camera/microphone preview on the host and guest
pages, but that preview is still not attached to the peer connection yet.

DS-039 adds initial media track attachment and a remote preview foundation.
DS-040 adds manual remote audio playback controls. DS-041 adds local microphone and
camera toggle controls that flip `MediaStreamTrack.enabled` on the active preview
tracks without renegotiation. Start local preview on both host and guest before
starting WebRTC if you want tracks to attach during the first
negotiation. If WebRTC starts without local preview, the data channel still works,
but media tracks are not attached in this PR. Renegotiation after preview start/stop
is intentionally out of scope. Remote video stays muted by default for autoplay
safety, and browsers require a user gesture before remote audio can be enabled.
DS-043 adds browser recording capability diagnostics that report MediaRecorder
support and MIME type readiness without starting recording. Recording, upload,
and export remain inactive.
DS-044 adds a read-only local recording state machine foundation that models the
future lifecycle without creating a recording.

The test is meant to verify the full local path:

- host session creation
- guest session join
- API session lookup and join flow
- signaling WebSocket connection
- WebRTC offer/answer exchange
- ICE candidate exchange
- remote preview arrival and manual remote audio playback
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

- sending local media tracks over `RTCPeerConnection`
- recording
- upload
- export
- auth

## Recording Capability Diagnostics

The local media preview panel now includes a recording capability diagnostics
section for the current browser and active preview stream.

- it checks whether `MediaRecorder` exists
- it checks whether `MediaRecorder.isTypeSupported` exists
- it reports the supported MIME types from the candidate list
- it reports the preferred MIME type when one is supported
- it shows whether a local preview stream is active
- it shows the current audio and video track counts
- it shows whether the browser and stream look ready for a future local recording prototype

Because the diagnostics are read-only, they should not trigger a browser permission
prompt by themselves. No recording file is created yet.

The same panel also includes a recording state machine diagnostics section.

- it starts in `idle`
- it shows the allowed next action from the initial state
- it confirms recording is not implemented yet
- it does not create files, chunks, or browser prompts

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

From the repository root, run:

```bash
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable" ./services/api/scripts/seed-local-webrtc.sh
```

If you use a different local demo user or studio, update the host form values to match valid rows in your database.

## Local Conflict Cleanup

This seed data is for local development only.

If your local database already has `host@example.com` under a different user ID or `test-studio` under a different studio ID, the seed script can fail because those columns are unique in the schema.

If you intentionally want to reset only those conflicting demo rows before seeding, run this from the repository root:

```bash
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DELETE FROM studios
WHERE slug = 'test-studio'
  AND id <> '2fd9c6d2-7328-4710-bf1d-ab6bd0d9fb2d';

DELETE FROM users
WHERE email = 'host@example.com'
  AND id <> '3c9abfe7-3133-4924-b159-f62277dfce7c';
COMMIT;
SQL
```

Use that cleanup only if you are deliberately resetting local demo data.

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

From the repository root, run:

```bash
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable" \
  ./services/api/scripts/migrate.sh up
```

3. Seed the local WebRTC demo rows.

From the repository root, run:

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

This browser-only flow starts after the services are already running.

1. Open `http://localhost:5173` in one browser window.
2. Fill in the host form and create a session.
3. On the host page, click `Start preview` and grant camera/microphone permission if the browser asks.
4. On the host page, click `Mute microphone` and `Disable camera` if you want to
   confirm the local controls before signaling starts.
5. On the host page, inspect the `Recording capability diagnostics` section and
   confirm it shows `Local stream available` as `Yes`, the audio/video track counts,
   and a supported MIME type summary.
6. Inspect the `Recording state machine diagnostics` section and confirm it starts
   in `idle` with `prepare` as the only available next action.
7. On the host page, open the signaling panel and click `Connect signaling`.
8. Keep the host page open.
9. Open the guest invite URL from the host session summary in a second browser window or private window.
10. Join the guest session.
11. On the guest page, click `Start preview` and grant camera/microphone permission if the browser asks.
12. On the guest page, inspect the `Recording capability diagnostics` section and
    confirm it reflects the guest preview stream.
13. On the guest page, click `Mute microphone` / `Unmute microphone` and
    `Disable camera` / `Enable camera` to confirm the local controls while preview is active.
14. On the guest page, click `Connect signaling`.
15. On the host page, click `Create peer connection / Start WebRTC test`.
16. Watch the host and guest logs for the offer, answer, ICE exchange, local track attachment, and remote track arrival.
17. Confirm the remote preview area appears when remote tracks arrive.
18. Click `Enable remote audio` on the side where you want to hear the remote stream.
19. Confirm the remote playback diagnostics switch to an enabled state after the click.
20. When the data channel opens, send a test message from the host.
21. If both sides show an open data channel, send a message from the guest too.

If you want media tracks attached, both sides must start local preview before the initial WebRTC offer/answer negotiation. In DS-039, the host attaches tracks during peer-connection setup, and the guest attaches tracks while handling the incoming offer and creating the answer.

If either side skips local preview before negotiation, the data channel can still work, but media tracks are not attached in DS-039. Renegotiation after preview start/stop remains out of scope. The DS-041 mic and camera toggles only change `MediaStreamTrack.enabled`; they do not replace tracks, renegotiate, or recreate the peer connection, and attached WebRTC senders should reflect the enabled state change.

The remote preview video stays muted until you explicitly enable audio. If playback fails, the panel shows a browser diagnostic message instead of silently unmuting.

## Expected Success States

On a successful run, you should see:

- the signaling WebSocket connected on both sides
- `connectionState` move into a connected or completed state
- `iceConnectionState` move into a connected or completed state
- `signalingState` return to `stable`
- `dataChannelState` change to `open`
- local preview active on both sides if media is being tested
- recording diagnostics show `No` until the browser and stream are ready
- `Peer connection exists` show `yes`
- `Local description` show `set`
- `Remote description` show `set`
- `Local tracks attached` shows `yes` on both sides when preview was started before negotiation
- microphone state shows `enabled` or `muted` after clicking the local toggle
- camera state shows `enabled` or `disabled` after clicking the local toggle
- remote stream available shows `yes` when remote tracks arrive
- remote audio enabled shows `yes` after `Enable remote audio` is clicked
- remote video/audio track counts update
- remote playback status and playback error diagnostics update when the user enables or mutes audio
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

This guide now covers the initial WebRTC media-attachment foundation as well as the
data-channel path.
The local camera and microphone preview exists for manual browser checks, but it
must be started before the first negotiation if you want tracks attached in DS-039.
Renegotiation after preview changes is intentionally deferred to a later task.
