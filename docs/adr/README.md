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
