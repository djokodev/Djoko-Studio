# Local Infrastructure

This folder is the future home of local and development environment files.

The local development environment plan is documented in
[docs/architecture/local-development-environment.md](../../docs/architecture/local-development-environment.md).

The future Docker Compose baseline will live here or be referenced from here.

DS-010 will add the first infrastructure-only Docker Compose baseline.

Planned local infrastructure dependencies:

- PostgreSQL
- MinIO
- NATS JetStream
- coturn

Implemented local infrastructure baseline:

- `docker-compose.yml`
- `.env.example`
