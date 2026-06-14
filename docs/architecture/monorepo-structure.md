# Monorepo Structure

## Status

Accepted

## Purpose

Djoko Studio v0.1 uses a polyglot monorepo so the browser application, backend services, workers, shared contracts, and local infrastructure can be developed together while still keeping clear runtime boundaries.

This document defines the initial repository layout only. It does not add implementations, runtime code, or dependency choices beyond the accepted architecture.

## Top-Level Folders

### `apps/`

Browser applications live here. For v0.1, this includes the web studio UI.

### `services/`

Backend services and worker runtimes live here. Each folder under `services/` maps to a focused deployable responsibility.

### `packages/`

Shared contracts, schemas, and generated/shared types live here. These packages support communication between the frontend and services.

### `infra/`

Local development and infrastructure-related files live here. This includes orchestration, observability, and environment support assets.

### `docs/`

Product, architecture, and ADR documentation live here.

## Boundary Rules

- `apps/` owns browser-facing product code and UI workflows.
- `services/` owns backend APIs, signaling, upload, and worker responsibilities.
- `packages/` owns cross-cutting contracts and shared/generated types only.
- `infra/` owns environment and deployment support files, not application logic.

## Relation to Accepted Architecture

This structure is the repository-level expression of ADR-0008, which establishes the polyglot monorepo and service-oriented boundaries.

It also reflects the accepted v0.1 technical stack in `v0.1-technical-stack.md`, including:

- React + TypeScript + Vite for the web studio
- Go for the API and signaling services
- Rust for upload and media workers
- PostgreSQL, MinIO, NATS JetStream, and FFmpeg in the supporting stack

## Scope

This task creates structure only.

No application code, Go modules, Rust crates, Docker Compose files, or generated artifacts are added yet.

