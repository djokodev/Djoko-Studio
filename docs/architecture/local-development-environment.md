# Local Development Environment

## Status

Draft

## Purpose

This document defines how Djoko Studio should run locally during development.

It is a plan for the intended local development setup, not the implementation itself.

## Goals

The local development environment should:

- make the project easy to run locally
- keep services isolated
- reflect the accepted v0.1 architecture
- support the polyglot monorepo
- prepare for the Docker Compose baseline
- avoid hiding important service boundaries
- help future Codex tasks work consistently

## Local Environment Principles

- Docker Compose is the local orchestration tool.
- Application services should eventually be runnable independently.
- Infrastructure dependencies should be containerized locally.
- Local setup should not require production cloud services.
- Local object storage should use MinIO.
- Local eventing should use NATS JetStream.
- Local database should use PostgreSQL.
- Local TURN/STUN should use coturn.
- Local secrets must not be committed.
- `.env.example` may be introduced later, but no `.env` secrets should be committed.

## Planned Local Services

These ports are initial local conventions and may change later if conflicts arise.

| Component | Local service | Purpose | Expected port |
| --- | --- | --- | --- |
| Browser app | `web-studio` | Local web studio UI | `5173` |
| Core API | `api` | Session, auth, and metadata API | `8080` |
| Signaling | `signaling` | WebRTC room and signaling coordination | `8081` |
| Upload | `upload` | Resumable media upload service | `8082` |
| Database | PostgreSQL | Relational metadata store | `5432` |
| Object storage API | MinIO API | S3-compatible local object storage | `9000` |
| Object storage console | MinIO console | Local admin console for object storage | `9001` |
| Event bus | NATS | Local message transport | `4222` |
| Event monitoring | NATS monitoring | HTTP monitoring and health visibility | `8222` |
| TURN/STUN | coturn | Local WebRTC relay and traversal support | `3478` |
| Media worker | `media-worker` | Media validation and assembly worker | `n/a` |
| Export worker | `export-worker` | Final export rendering worker | `n/a` |

## Planned Dependency Flow

- `web-studio` talks to `api`, `signaling`, and `upload`.
- `api` talks to PostgreSQL and may publish events later.
- `signaling` coordinates WebRTC room messages and uses coturn indirectly through WebRTC configuration.
- `upload` stores media chunks in MinIO or other S3-compatible object storage.
- `upload` publishes completion events to NATS JetStream later.
- `media-worker` consumes media events from NATS JetStream.
- `export-worker` consumes export events from NATS JetStream.
- Workers use FFmpeg locally in a later task.

## What Docker Compose Should Eventually Include

The future Docker Compose baseline should include:

- PostgreSQL
- MinIO
- NATS JetStream
- coturn

Application services may be added later after they are scaffolded:

- `apps/web-studio`
- `services/api`
- `services/signaling`
- `services/upload`
- `services/media-worker`
- `services/export-worker`

## DS-010 Compose Baseline

DS-010 introduces the first Docker Compose baseline at
[`infra/local/docker-compose.yml`](../../infra/local/docker-compose.yml).

This baseline includes infrastructure services only.
Application services will be added later after they are scaffolded.

The ports listed above remain local development conventions and may change later if conflicts arise.

## What DS-009 Does Not Implement

This task does not implement any runtime or infrastructure artifacts.

- no `docker-compose.yml` is created in this task
- no service Dockerfiles are created
- no application services are scaffolded
- no database schema is created
- no MinIO buckets are created
- no NATS streams are created
- no coturn configuration is created
- no secrets are committed
