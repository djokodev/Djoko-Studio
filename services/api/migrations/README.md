# API Migrations

This directory will contain ordered SQL migrations for `services/api`.

## Current state

- `00001_create_v0_1_core_tables.sql` adds the initial v0.1 schema
- the migration creates `users`, `studios`, `sessions`, `participants`, `recordings`, `recording_tracks`, `uploads`, and `exports`
- `00002_add_export_last_error.sql` adds the nullable `last_error` column to `exports`
- DS-023 introduces the first product migration set

## Working with migrations

- review migration files carefully before applying them to shared environments
- keep migration filenames ordered so Goose applies them predictably
- migrations are manual for now and are not run by app startup
- use the API migration script to run `status`, `up`, `down`, and other Goose commands against this directory
- `DATABASE_URL` is required for every migration command
- the validation script does not require PostgreSQL

## Manual commands

```bash
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable" ./services/api/scripts/migrate.sh status
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable" ./services/api/scripts/migrate.sh up
DATABASE_URL="postgres://djoko:djoko_local_password@localhost:5432/djoko_studio?sslmode=disable" ./services/api/scripts/migrate.sh down
```
