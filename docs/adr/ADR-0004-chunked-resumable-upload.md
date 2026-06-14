# Chunked resumable upload

## Status

Accepted

## Date

2026-06-14

## Context

The product targets unstable network conditions, so uploads must survive interruptions without forcing users to restart from zero.

## Decision

Recorded media must be uploaded using chunks with resumable upload behavior.

## Consequences

- backend must track upload state
- chunks need ordering and validation
- retry and resume logic is required
- upload completion must be explicit

## Alternatives considered

- upload media as a single file
- rely on best-effort retry without explicit resume state

## Follow-up questions

- How should chunk size be selected?
- What upload state needs to be persisted for recovery?
