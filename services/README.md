# Services

This folder contains backend services and worker runtimes in the Djoko Studio monorepo.

Each service is a focused deployable unit with a clear responsibility boundary.

Monorepo rule:

- services may depend on `packages/`
- services must not depend on browser app code
- services should communicate through contracts, events, or explicit service boundaries
