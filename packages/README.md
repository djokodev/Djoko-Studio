# Packages

This folder contains shared contracts, schemas, and generated or shared types used across the monorepo.

Keep package contents focused on cross-service interfaces rather than deployable runtime code.

Monorepo rule:

- packages should remain runtime-neutral
- packages must not contain deployable app or service entrypoints
- packages are the place for shared abstractions, contracts, and generated types only
