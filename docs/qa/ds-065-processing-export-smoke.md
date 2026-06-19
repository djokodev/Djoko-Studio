# DS-065 Processing & Export Smoke Test

## Goal

Verify the local direct export flow from the browser to the export worker.

## Prerequisites

- MinIO running locally
- upload service running and able to write upload manifests/chunks
- export worker running on `http://localhost:8083`
- web studio running with `VITE_EXPORT_BASE_URL=http://localhost:8083`

## Smoke steps

1. Open the web studio host flow and create a session.
2. Start local preview and record a short clip.
3. Finish the local recording and confirm the upload readiness panel shows an uploaded local recording.
4. Open the Processing & Export dashboard.
5. Confirm the dashboard shows export service readiness, the recording ID, the upload ID, and target `MP4 1080p`.
6. Click `Start 1080p export`.
7. Wait for the export status to become `ready`.
8. Click `Refresh export status` and confirm the status still reads `ready`.
9. Click `Download export` and confirm the browser downloads a final MP4 file.

## Expected results

- the export worker readiness endpoint reports `status: ok` when MinIO and FFmpeg are available
- the export manifest is persisted in MinIO
- the final MP4 is persisted in MinIO
- the dashboard remembers the last export ID after refresh
- failed exports surface a readable error message in the dashboard

