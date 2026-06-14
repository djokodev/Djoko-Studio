# Storage, queue and rendering stack

## Status

Accepted

## Date

2026-06-14

## Context

Djoko Studio needs durable storage for media artifacts, a job/event system for asynchronous processing, and a rendering path for the first final export format.

## Decision

v0.1 uses PostgreSQL, S3-compatible object storage, MinIO for local/dev, NATS JetStream for events and queueing, and FFmpeg CPU rendering for MVP.

## Consequences

- PostgreSQL stores relational metadata
- object storage stores media assets
- MinIO enables local S3-compatible development
- NATS JetStream coordinates async media jobs
- FFmpeg CPU rendering is used first
- GPU acceleration is deferred

## Alternatives considered

- a different relational database
- a non-S3 object storage model
- a different queue or event system
- GPU-first rendering

## Follow-up questions

- What object storage lifecycle and retention rules should be set first?
- Which job state transitions should be observable in the MVP?
