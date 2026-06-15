# Services

This folder contains backend services and worker runtimes in the Djoko Studio monorepo.

Each service is a focused deployable unit with a clear responsibility boundary.

Monorepo rule:

- services may depend on `packages/`
- services must not depend on browser app code
- services should communicate through contracts, events, or explicit service boundaries

Upload service status:

- `services/upload` is scaffolded in Rust with Axum and Tokio
- it currently exposes only health and readiness endpoints
- upload, storage, and media pipeline logic are still deferred
