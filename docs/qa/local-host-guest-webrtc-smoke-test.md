# Local Host/Guest WebRTC Smoke Test

## Goal

Verify the local one-host/one-guest signaling flow, the new room presence events,
and the existing browser WebRTC wiring with a simple end-to-end smoke test.

## Services to start

Start these local services before testing:

- PostgreSQL, or another local database configured through `DATABASE_URL`
- API service
- signaling service
- web-studio app

Typical local commands:

```bash
docker compose -f infra/local/docker-compose.yml up -d postgres
cd services/api && go run ./cmd/api
cd services/signaling && go run ./cmd/signaling
cd apps/web-studio && npm run dev
```

## Manual flow

1. Start the API, signaling service, and web-studio.
2. Open the host page.
3. Start local camera and microphone preview on the host.
4. Open the guest URL in another browser window or a private window.
5. Start local camera and microphone preview on the guest.
6. Connect signaling on the host.
7. Connect signaling on the guest.
8. Confirm `room-state` and `peer-joined` show up in the presence and event log.
9. Start WebRTC from the host.
10. Confirm the remote media area appears when browser permissions allow playback.
11. Optionally send a data channel test message.

## Expected result

- the host page renders
- the guest page renders
- host and guest can both connect signaling
- the host sees `peer-joined` when the guest joins
- the guest sees `room-state` with the host as the peer when the room state arrives
- peer presence shows `connected`
- the host cannot start WebRTC until peer presence is connected
- the host can start WebRTC once peer presence is connected
- remote media appears when the browser allows the media path to complete
- a data channel test message can be exchanged after the peer connection is open

## Known limitations

- one host and one guest only
- no SFU
- no multi-guest rooms
- no production auth
- no remote recording or export yet
- no upload behavior is expected in this test
- browser autoplay or permission prompts may still block the remote preview until you approve playback or device access
