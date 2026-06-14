# Rust upload and media workers

## Status

Accepted

## Date

2026-06-14

## Context

Uploading, validating, assembling, and rendering media are performance-sensitive tasks. Djoko Studio needs predictable concurrency and strong reliability around file handling and media orchestration.

## Decision

The upload service and media workers use Rust, with Axum/Tokio for the upload service and Rust workers around FFmpeg for media processing.

## Consequences

- Rust is used for performance-sensitive I/O and media pipeline tasks
- the upload service handles tus resumable upload
- media and export workers orchestrate FFmpeg
- increased implementation complexity is accepted for performance and reliability

## Alternatives considered

- implementing the pipeline in Go
- implementing the pipeline in Python
- using a single media service without worker boundaries

## Follow-up questions

- What worker retry and idempotency rules should be standardized first?
- How should upload checksum validation be surfaced across services?
