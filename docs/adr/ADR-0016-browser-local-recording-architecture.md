# Browser local recording architecture

## Status

Proposed

## Date

2026-06-16

## Context

Djoko Studio needs to produce high-quality recordings even when the live WebRTC call is unstable. The recording path must not depend on receiving remote media, because the product promise is to preserve the participant's own capture even when network quality drops or signaling becomes unreliable.

The browser will eventually be responsible for recording each participant's own local camera and microphone stream. Host recordings should come from the host's local tracks, and guest recordings should come from the guest's local tracks. Upload and export are separate concerns that will be introduced later.

This document defines the intended browser recording architecture before any MediaRecorder implementation is added.

## Decision

Djoko Studio should record the participant's own local `MediaStream` in the browser.

- The first recording implementation should start with local-only recording for one participant and one browser session.
- Remote WebRTC stream recording is not part of the first implementation.
- Recording should be modeled as a state machine so lifecycle transitions remain explicit and testable.
- Recording output should be produced in chunks rather than as one unbounded blob.
- Chunk metadata should be stable and structured so later persistence, upload, and recovery layers can build on it.
- Later work will persist chunks locally, upload them resumably, and combine participant tracks in backend or export systems.

## Proposed future recording state machine

The browser recording lifecycle should use explicit states:

- `idle`
- `preparing`
- `recording`
- `paused` optional and future only if deliberately supported
- `stopping`
- `stopped`
- `failed`

Allowed transitions should be constrained so the UI and persistence layers can reason about recording progress:

- `idle` -> `preparing` when recording is requested
- `preparing` -> `recording` when capture is ready and the recorder has started
- `preparing` -> `failed` when capture setup fails
- `recording` -> `stopping` when stop is requested
- `recording` -> `paused` only if pause support is intentionally implemented later
- `paused` -> `recording` only if pause support is intentionally implemented later
- `paused` -> `stopping` when stop is requested
- `stopping` -> `stopped` after final chunk flush and cleanup
- `any active state` -> `failed` on unrecoverable recorder, permission, or device errors
- `stopped` -> `idle` when the user starts a new recording session

## Chunk metadata plan

Future chunks should carry stable metadata so later persistence and upload systems can correlate them with their source recording and session.

Planned metadata fields include:

- `recordingId`
- `sessionId`
- `participantId`
- `trackKind` or `mediaKind`
- `chunkIndex`
- `mimeType`
- `startedAt`
- `endedAt` or `durationMs`
- `sizeBytes`
- `checksum` or hash later if needed
- `uploadStatus` later

The exact runtime types are intentionally deferred in this document. The important part for now is that chunk identity, ordering, timing, and source ownership are explicit.

## Browser capability constraints

Browser recording support is not uniform, so the implementation plan must assume capability detection is required.

- `MediaRecorder` support varies by browser and browser version.
- MIME type support must be detected before recording starts.
- Audio and video codec choices should be explicit rather than implied.
- A future capability diagnostic should report whether a given browser can safely record with the chosen configuration.
- Large recordings must not be kept only in memory, because that would create a brittle failure mode for long sessions.

## Failure modes and recovery needs

The recording architecture should anticipate the common ways browser capture can fail or be interrupted.

- permission denied for camera or microphone access
- unsupported or rejected `MediaRecorder` MIME type
- recorder start failure after devices are selected
- device unplug or hardware capture interruption
- browser tab refresh, crash, or accidental close
- storage exhaustion while buffering or persisting chunks
- network failure during later upload steps
- partial chunk creation that must be distinguishable from a clean stop

Recovery needs for those failures should include:

- preserving already produced chunks when possible
- recording enough metadata to resume or reconcile an interrupted session later
- surfacing a failed or incomplete state clearly instead of silently discarding data
- keeping upload failure separate from capture failure so local recording can survive transient transport issues

## Local persistence plan

The long-term recording system should preserve chunks locally so refreshes, crashes, and upload interruptions do not destroy a completed or in-progress recording.

- In-memory only buffering is acceptable only for the smallest prototype and is not production-safe.
- IndexedDB or OPFS should be evaluated for resilient local chunk persistence.
- Future recovery should be able to discover incomplete local recordings after a refresh or crash where the browser storage model allows it.
- This PR does not implement persistence.

## Upload and recovery boundaries

Recording, persistence, upload, and recovery should remain separate layers.

- Upload service integration is separate from recording capture.
- Recording should be able to continue or preserve chunks even if upload fails.
- Upload should later be resumable.
- A recovery screen is future work.
- This document does not introduce upload or recovery behavior.

## Testing strategy

Future tests should cover the recording lifecycle and the browser capability boundary.

- unit tests for the state machine
- browser smoke test for capability detection
- manual test for start and stop recording
- manual test for long recording chunk production
- manual test for permission denied
- manual test for refresh or crash recovery once persistence exists
- future upload resume tests

## Staged implementation proposal

Future work should be split into small steps so recording risk stays contained:

- DS-043: Add browser recording capability diagnostics
- DS-044: Add local recording state machine foundation
- DS-045: Add local MediaRecorder prototype without persistence or upload
- DS-046: Add local chunk metadata model
- DS-047: Add local persistence spike and decision for IndexedDB vs OPFS
- DS-048: Add local recording recovery listing foundation

## Explicit non-goals

- no recording implementation
- no UI recording controls
- no upload
- no export
- no backend changes
- no database changes
- no remote stream recording
- no multi-guest recording
- no mobile-specific recording behavior

## Consequences

- the recording architecture is defined before implementation details expand the codebase
- future work can build a chunked, recoverable browser recording pipeline with clearer boundaries
- the browser capability and storage decisions are deferred, so implementation will still need a follow-up ADR or implementation decision before code lands

## Alternatives considered

- implement MediaRecorder immediately without a separate architecture plan
- record only remote WebRTC streams
- keep recordings as one in-memory blob per session
- merge recording, upload, and recovery into one step

## Follow-up questions

- Which browser capability checks should be treated as hard blockers versus warnings?
- Should the first persistence layer prefer OPFS or IndexedDB once implementation begins?
- What minimal recovery UI should surface incomplete local recordings after refresh or crash?
