# Browser recording and local persistence

## Status

Accepted

## Date

2026-06-14

## Context

The browser recording layer must be reliable for v0.1 while keeping implementation risk controlled. Local persistence must protect media chunks and recording state through refreshes, interruptions, and upload recovery.

## Decision

v0.1 uses MediaRecorder for browser recording, OPFS for media chunks, and IndexedDB for metadata, manifests and upload state.

## Consequences

- MediaRecorder is accepted for v0.1 to reduce implementation risk
- WebCodecs is deferred for later low-level control
- OPFS stores large media chunks
- IndexedDB stores structured recording and upload metadata

## Alternatives considered

- WebCodecs from day one
- storing large media chunks in IndexedDB
- skipping local persistence and relying on direct upload

## Follow-up questions

- Which metadata keys should be treated as durable recording recovery state?
- What recovery UI should be shown when local chunks are incomplete?
