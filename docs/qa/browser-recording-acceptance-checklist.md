# Browser Recording Acceptance Checklist

## Purpose

This checklist validates the local browser Recording Core before the team starts resumable upload work. It defines the minimum QA gate for the browser-only recording path so later upload architecture can build on a stable local foundation.

## Scope

This checklist covers:

- recording capability diagnostics
- local recording start and stop
- in-memory playback preview
- manifest and chunk metadata
- IndexedDB persistence
- refresh and recovery flow
- recovered playback preview
- raw local download
- local browser storage summary
- individual discard
- clear-all local recordings
- local integrity diagnostics

## Non-goals

This checklist does not validate:

- upload
- backend persistence
- cloud sync
- final export
- 1080p render
- separate tracks export
- cryptographic checksum
- repair workflow

## Test Environment Matrix

| Browser | OS | Camera/microphone permission | Expected result | Status |
| --- | --- | --- | --- | --- |
| Chrome / Chromium desktop | Desktop OS used for local QA | Allowed for required scenarios | Required for MVP local QA | Not validated yet |
| Firefox desktop | Desktop OS used for local QA | Allowed for optional comparison | Optional later | Not validated yet |
| Safari desktop | Desktop OS used for local QA | Allowed for later manual coverage | Optional later | Not validated yet |
| Mobile browser | Mobile OS used for local QA | Allowed for later manual coverage | Optional later | Not validated yet |

Do not claim a browser is validated unless it has actually been tested.

## Acceptance Scenarios

### A. Idle capability diagnostics

Steps:

1. Open the app.
2. Verify camera and microphone support messaging.
3. Verify recording capability diagnostics render.

Expected result:

- no crash
- clear capability state

### B. Permission denied path

Steps:

1. Deny camera and microphone permission.
2. Observe the local recording area.

Expected result:

- the app remains stable
- clear error or help text appears
- no recording starts

### C. Start and stop local recording

Steps:

1. Grant camera and microphone permission.
2. Start recording.
3. Stop recording.

Expected result:

- recording state transitions correctly
- manifest appears
- chunks appear

### D. In-memory playback preview

Steps:

1. After stop, verify the local preview.

Expected result:

- a playback `ObjectURL` appears
- playback works if the browser supports it

### E. Raw local download safety copy

Steps:

1. After stop, click download.

Expected result:

- the raw browser recording downloads with a safe DNA Studio filename
- this is not final export

### F. IndexedDB persistence

Steps:

1. After stop, verify persisted status.

Expected result:

- manifest and chunks are persisted
- storage summary updates

### G. Refresh and recovery

Steps:

1. Refresh the page before discarding.

Expected result:

- persisted recording is detected
- recovery panel appears

### H. Recovered playback preview

Steps:

1. Click preview local copy.

Expected result:

- the recovered `Blob` and `ObjectURL` are rebuilt
- playback is available

### I. Local browser storage summary

Steps:

1. Verify count, approximate size, chunks, and browser estimate if available.

Expected result:

- values render without crashing
- unsupported browser estimate is handled gracefully

### J. Local integrity diagnostics

Steps:

1. Check or recheck the local copy.

Expected result:

- a local-only integrity report appears
- expected and stored chunks and bytes are shown

### K. Individual discard

Steps:

1. Discard a persisted local copy.

Expected result:

- the recovery item disappears
- the integrity report clears
- the storage summary refreshes

### L. Clear-all local recordings

Steps:

1. Create or keep at least one persisted recording.
2. Click clear-all.
3. Confirm the dialog.

Expected result:

- all persisted local recordings are removed
- the recovery panel clears
- the storage summary returns to zero

### M. Reset current recording

Steps:

1. Record a new clip.
2. Stop recording.
3. Reset or discard the current recording.

Expected result:

- the current recording ID clears
- manifest and chunks clear
- preview and transient state clear

### N. No accidental upload or export UI

Steps:

1. Inspect the UI during all flows.

Expected result:

- no upload claims appear
- no cloud sync claims appear
- no final export claims appear
- no server backup claims appear

## Pass or Fail Criteria

Recording Core is acceptable for moving toward upload architecture when:

- Chrome desktop passes required scenarios A through N
- permission-denied path is stable
- refresh and recovery work at least once manually
- raw local download works
- storage summary and integrity diagnostics render without crashes
- no backend, upload, or export claims appear in the UI
- known limitations are documented

## Known Limitations

- browser storage estimates vary by browser
- MediaRecorder MIME support varies by browser
- no checksum yet
- no repair workflow yet
- no upload yet
- no final export yet
- no automated browser test suite yet, if still true
- manual camera and microphone testing is still required

## Recommended Next Step

After this checklist is accepted, the next project phase should be an upload and resumable upload architecture ADR.

The resumable upload architecture is documented in
[`docs/adr/ADR-0017-resumable-recording-upload-architecture.md`](../adr/ADR-0017-resumable-recording-upload-architecture.md).
