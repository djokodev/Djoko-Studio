# Infrastructure

This folder contains infrastructure and local development orchestration for Djoko Studio.

Future scope includes:

- Docker Compose
- PostgreSQL
- MinIO
- NATS JetStream
- coturn
- monitoring

No infrastructure implementation yet.

Monorepo rule:

- infra must not contain application runtime code
- infra should stay focused on environment, orchestration, and operational support files
