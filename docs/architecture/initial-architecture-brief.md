# Initial Architecture Brief

## Status

Draft

## Purpose

This document provides the first conceptual architecture view of Djoko Studio v0.1. It describes the major system areas, the expected data flow, and the constraints that shape the platform before any concrete implementation stack is chosen.

## Product Promise

> The live call may adapt to network quality, but the final recording must remain safe, recoverable and high quality.

## Architecture Principles

- local-first recording
- resilience before polish
- final recording quality over live call quality
- recovery-oriented design
- separated raw tracks
- small MVP scope
- defer concrete stack decisions until constraints are clear

## Main System Areas

### 1. Web Studio Client

Responsibility:

- present the recording studio experience in the browser
- handle host and guest session entry
- capture local media
- show recording, call, and upload state

Must handle in v0.1:

- desktop web recording for one host and one guest
- guest entry through invitation link without an account
- local media persistence before upload
- recovery after refresh, temporary disconnect, or browser interruption

Remains open:

- framework choice
- browser storage strategy
- media capture and recovery implementation details
- exact UX for incomplete upload warnings and retry flows

### 2. Signaling and Room Coordination

Responsibility:

- coordinate who is in a session
- support live call setup and connection state
- keep host and guest synchronized during the recording session

Must handle in v0.1:

- session creation and room entry
- one-host-one-guest coordination
- invitation-link based guest access
- live call state needed for the recording experience

Remains open:

- signaling protocol
- room state model
- transport details
- how session metadata is synchronized between client and backend

### 3. Backend API

Responsibility:

- provide the server-side session and recording control surface
- persist session metadata and upload state
- expose APIs needed by the client and processing pipeline

Must handle in v0.1:

- host session creation
- guest session association
- recording state tracking
- upload session and chunk state tracking
- download or export metadata

Remains open:

- backend framework
- API style
- authentication and authorization implementation details
- database model boundaries

### 4. Upload and Recovery System

Responsibility:

- move locally recorded media to durable storage safely
- resume interrupted transfers
- ensure uploads are explicit, trackable, and recoverable

Must handle in v0.1:

- chunked resumable uploads
- retry after network instability
- recovery after browser refresh or temporary offline state
- upload completion tracking

Remains open:

- resumable upload protocol
- chunk sizing and retry policy
- local upload queue design
- upload verification and reconciliation details

### 5. Media Storage

Responsibility:

- hold uploaded raw media durably
- preserve source media for recovery and future processing
- keep track of session media artifacts

Must handle in v0.1:

- storage of raw participant tracks
- storage of upload chunks and assembled media
- retention of source material for exports and raw downloads

Remains open:

- object storage choice
- metadata indexing approach
- retention and lifecycle rules
- storage layout for session artifacts

### 6. Processing Workers

Responsibility:

- validate uploaded media
- assemble session media into usable processing inputs
- prepare artifacts for export generation

Must handle in v0.1:

- detect complete vs incomplete uploads
- validate raw tracks
- assemble and normalize uploaded media for export processing

Remains open:

- worker runtime
- queue system
- validation strategy
- failure retry and idempotency strategy

### 7. Export and Rendering Pipeline

Responsibility:

- create the final deliverable from validated media
- produce the first release export format

Must handle in v0.1:

- final 1080p 16:9 export
- YouTube-ready output
- preservation of raw tracks alongside the final export

Remains open:

- rendering toolchain
- export job orchestration
- quality checks before export completion
- future export formats

### 8. Observability and Operational Monitoring

Responsibility:

- reveal when the system is healthy, degraded, or failing
- help operators understand recording, upload, and processing progress

Must handle in v0.1:

- visibility into upload progress
- visibility into processing and export status
- operational signals for failures, retries, and incomplete sessions

Remains open:

- observability stack
- logging, metrics, and alerting choices
- dashboards and operational thresholds
- trace and event correlation strategy

## Conceptual Data Flow

1. Host creates a studio/session.
2. Guest joins through invitation link.
3. Host and guest connect through live call coordination.
4. Browser records media locally.
5. Raw tracks are persisted locally before upload.
6. Tracks are uploaded in resumable chunks.
7. Backend tracks upload state.
8. Storage keeps raw chunks/tracks.
9. Workers assemble and validate uploaded media.
10. Rendering pipeline creates the final 1080p 16:9 export.
11. Host can download final export and raw tracks.

## Reliability Model

The architecture is shaped to protect the recording path against common failure conditions:

- unstable internet: local recording continues even if the network degrades, and uploads can resume later
- browser refresh or accidental close: local persistence and resumable upload state allow recovery instead of restarting from zero
- interrupted uploads: chunked transfer and explicit upload tracking make retries possible
- guest upload delays: backend tracking and processing visibility let the host see that a session is not yet complete
- live call quality degradation: the live call can adapt without redefining the quality of the final recording artifact
- incomplete recordings: processing and export only advance when the required media is present and valid

This is a resilience-oriented design, not a promise that every failure is impossible. The goal is to preserve the recording through normal, expected disruptions.

## Boundaries and Non-Goals

v0.1 does not include:

- mobile support
- multi-guest interviews
- livestreaming
- screen sharing
- payments
- transcript editing
- advanced video editing
- direct publishing
- vertical/social exports

## Open Architecture Questions

These questions must be resolved later through ADRs:

- frontend framework
- backend framework
- database
- object storage
- worker/queue system
- resumable upload protocol
- local browser storage strategy
- rendering toolchain
- deployment model
- observability stack
- migration strategy

## Related ADRs

- [ADR-0001: Local-first browser recording](../adr/ADR-0001-local-first-browser-recording.md)
- [ADR-0002: MVP limited to one host and one guest](../adr/ADR-0002-one-host-one-guest-mvp.md)
- [ADR-0003: Guests join without account](../adr/ADR-0003-guests-join-without-account.md)
- [ADR-0004: Chunked resumable upload](../adr/ADR-0004-chunked-resumable-upload.md)
- [ADR-0005: Separate raw tracks](../adr/ADR-0005-separate-raw-tracks.md)
- [ADR-0006: Defer concrete technology stack choices](../adr/ADR-0006-defer-concrete-technology-stack-choices.md)
- [ADR-0007: Final export target is 1080p 16:9](../adr/ADR-0007-final-export-1080p-16-9.md)
