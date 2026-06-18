# DS-063 Recording Recovery Manual Smoke Test

## Goal
Verify the real local recording session integration (Host/Guest), IndexedDB persistence, reload/refresh recovery, warning before page closing (unload), and recovery UI.

## Prerequisites
Start all required local services:
```bash
docker compose -f infra/local/docker-compose.yml up -d postgres
cd services/api && go run ./cmd/api
cd services/signaling && go run ./cmd/signaling
cd apps/web-studio && npm run dev
```

## Manual Verification Checklist

- [ ] **1. Start local camera/microphone preview (Host & Guest)**
  - Open host page at `http://localhost:5173`.
  - Click "Start preview" on the Host page and allow permissions.
  - Submit the Create Session form.
  - Open the generated Guest invite link in a private/incognito window (or another browser).
  - Click "Start preview" on the Guest page and allow permissions.
  - Enter a display name and join the session.

- [ ] **2. Connect signaling and WebRTC**
  - Click "Connect signaling" on both Host and Guest rooms.
  - Confirm peer presence changes to "Connected".
  - Click "Create peer connection / Start WebRTC test" on the Host.
  - Confirm the remote media stream video is rendered and playing on both pages.

- [ ] **3. Local recording start/stop (Host)**
  - Click "Start local recording" on the Host page.
  - Verify that the status transitions to "Recording" and the timer increments.
  - Confirm that metadata (Session ID, Participant ID, Role: host) is displayed.
  - Let it record for 5-10 seconds.
  - Click "Stop local recording" on the Host page.
  - Verify that the status transitions to "Stopped" and a "Playback preview" video appears.

- [ ] **4. Local recording start/stop (Guest)**
  - Click "Start local recording" on the Guest page.
  - Verify that the status transitions to "Recording" and the timer increments.
  - Confirm that metadata (Session ID, Participant ID, Role: guest) is displayed.
  - Let it record for 5-10 seconds.
  - Click "Stop local recording" on the Guest page.
  - Verify that the status transitions to "Stopped" and a "Playback preview" video appears.

- [ ] **5. Unload warning test (beforeunload)**
  - Try to refresh or close either the Host or Guest page.
  - Confirm that the browser triggers a confirmation prompt warning you that you have unsaved local recordings.
  - Choose to stay on the page.

- [ ] **6. Raw local download**
  - In the "Playback preview" section of both pages, click "Download raw local copy".
  - Verify that a `.webm` file downloads with a name matching the pattern: `dna-studio-local-recording-[recordingId]-[timestamp].webm`.
  - Open and play the downloaded file locally to confirm it has valid audio and video.

- [ ] **7. Refresh recovery**
  - Refresh the page (confirming the unload prompt).
  - Verify that the "Recovery" panel now shows: "Local recording found in this browser: Detected".
  - Verify that the recording is listed with its correct metadata (Session ID, Participant ID, Role, mime type, size, chunk count).
  - Verify that the upload status is clearly marked as "Not uploaded (Local only)".

- [ ] **8. Recovered preview and download**
  - Click "Preview local copy" on the recovered recording.
  - Verify that the video player in the "Recovered playback" section loads the recording successfully.
  - Test playback and click "Download raw local copy" in this section to confirm download works after recovery.

- [ ] **9. Discard and cleanup**
  - In the "Storage" section, verify that the summary reports the correct number of persisted recordings and total size.
  - Click "Discard local copy" on the recovered recording or "Clear all local recordings" in the storage section.
  - Confirm the dialog.
  - Verify that the recording is deleted from the recovery list and the unload warning is no longer active when you refresh/close the tab.
