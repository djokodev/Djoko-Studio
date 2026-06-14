# Local Infrastructure

This folder is the future home of local and development environment files.

The local development environment plan is documented in
[docs/architecture/local-development-environment.md](../../docs/architecture/local-development-environment.md).

The local Docker Compose baseline lives in
[`docker-compose.yml`](./docker-compose.yml).

DS-010 introduced the first infrastructure-only Docker Compose baseline.

This baseline is local-only and includes infrastructure dependencies only.
Application services are not included yet.

Bucket creation, NATS stream creation, schemas, migrations, and app services come later.

Planned local infrastructure dependencies:

- PostgreSQL
- MinIO
- NATS JetStream
- coturn

Implemented local infrastructure baseline:

- `docker-compose.yml`
- `.env.example`

## How To Start

```bash
cd infra/local
cp .env.example .env
docker compose up -d
```

## Status

```bash
docker compose ps
```

## Stop

```bash
docker compose down
```

## Reset Local Data

```bash
docker compose down -v
```

## Local Services

- PostgreSQL: `localhost:5432`
- MinIO API: `localhost:9000`
- MinIO console: `http://localhost:9001`
- NATS: `localhost:4222`
- NATS monitoring: `http://localhost:8222`
- coturn: `localhost:3478/tcp` and `3478/udp`
