# Local-first browser recording

## Status

Accepted

## Date

2026-06-14

## Context

Djoko Studio must protect the final recording against unstable network conditions. If recording depends only on the live connection, the core product promise is too fragile.

## Decision

Djoko Studio v0.1 must record media locally in the browser before upload.

## Consequences

- more client-side complexity
- need for local persistence
- need for upload recovery
- better protection against unstable networks

## Alternatives considered

- record only on the server
- rely on live-stream capture without local persistence

## Follow-up questions

- What browser storage strategy should be used for local persistence?
- How should local recording recovery be surfaced to the host?
