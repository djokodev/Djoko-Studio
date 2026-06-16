# ADRs

Architecture Decision Records (ADRs) are short Markdown documents that capture important architectural and product-architecture decisions.

Djoko Studio uses ADRs to keep the project aligned on the reasons behind major decisions before implementation expands the codebase. The product and architecture are intentionally documented in Markdown so the decision history stays easy to review and update.

## When to create a new ADR

Create a new ADR when a decision is:

- architecture-shaping
- hard to reverse later
- likely to affect multiple features or teams
- a meaningful product constraint that technical work must follow

If a decision is still open, capture the options and follow-up questions in an ADR draft rather than making an untracked choice in code.

## ADR status values

Use one of these status values in ADR files:

- `Proposed`
- `Accepted`
- `Rejected`
- `Superseded`

## Naming

ADR files should use this format:

`ADR-0001-short-decision-title.md`

Use a four-digit ADR number, keep the slug lowercase, and separate words with hyphens.

## Current ADR index

| ADR | Title | Status | File |
| --- | --- | --- | --- |
| ADR-0001 | Local-first browser recording | Accepted | [ADR-0001-local-first-browser-recording.md](./ADR-0001-local-first-browser-recording.md) |
| ADR-0002 | MVP limited to one host and one guest | Accepted | [ADR-0002-one-host-one-guest-mvp.md](./ADR-0002-one-host-one-guest-mvp.md) |
| ADR-0003 | Guests join without account | Accepted | [ADR-0003-guests-join-without-account.md](./ADR-0003-guests-join-without-account.md) |
| ADR-0004 | Chunked resumable upload | Accepted | [ADR-0004-chunked-resumable-upload.md](./ADR-0004-chunked-resumable-upload.md) |
| ADR-0005 | Separate raw tracks | Accepted | [ADR-0005-separate-raw-tracks.md](./ADR-0005-separate-raw-tracks.md) |
| ADR-0006 | Defer concrete technology stack choices | Accepted | [ADR-0006-defer-concrete-technology-stack-choices.md](./ADR-0006-defer-concrete-technology-stack-choices.md) |
| ADR-0007 | Final export target is 1080p 16:9 | Accepted | [ADR-0007-final-export-1080p-16-9.md](./ADR-0007-final-export-1080p-16-9.md) |
| ADR-0008 | Polyglot monorepo service architecture | Accepted | [ADR-0008-polyglot-monorepo-service-architecture.md](./ADR-0008-polyglot-monorepo-service-architecture.md) |
| ADR-0009 | React, TypeScript and Vite for the web studio | Accepted | [ADR-0009-react-typescript-vite-web-studio.md](./ADR-0009-react-typescript-vite-web-studio.md) |
| ADR-0010 | Go API and signaling services | Accepted | [ADR-0010-go-api-and-signaling-services.md](./ADR-0010-go-api-and-signaling-services.md) |
| ADR-0011 | Rust upload and media workers | Accepted | [ADR-0011-rust-upload-and-media-workers.md](./ADR-0011-rust-upload-and-media-workers.md) |
| ADR-0012 | Browser recording and local persistence | Accepted | [ADR-0012-browser-recording-and-local-persistence.md](./ADR-0012-browser-recording-and-local-persistence.md) |
| ADR-0013 | WebRTC P2P with coturn for live call | Accepted | [ADR-0013-webrtc-p2p-coturn-live-call.md](./ADR-0013-webrtc-p2p-coturn-live-call.md) |
| ADR-0014 | Storage, queue and rendering stack | Accepted | [ADR-0014-storage-queue-and-rendering-stack.md](./ADR-0014-storage-queue-and-rendering-stack.md) |
| ADR-0015 | Defer reverse proxy / gateway choice | Accepted | [ADR-0015-defer-reverse-proxy-gateway-choice.md](./ADR-0015-defer-reverse-proxy-gateway-choice.md) |
| ADR-0016 | Browser local recording architecture | Proposed | [ADR-0016-browser-local-recording-architecture.md](./ADR-0016-browser-local-recording-architecture.md) |
