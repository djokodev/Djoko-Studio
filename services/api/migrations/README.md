# API Migrations

This directory will contain ordered SQL migrations for `services/api`.

## Current state

- no product migrations exist yet
- DS-023 will add the initial schema migrations

## Working with migrations

- review migration files carefully before applying them to shared environments
- keep migration filenames ordered so Goose applies them predictably
- use the API migration script to run `status`, `up`, `down`, and other Goose commands against this directory
