# Polyglot monorepo service architecture

## Status

Accepted

## Date

2026-06-14

## Context

Djoko Studio v0.1 needs a repository structure that supports coordinated development across the browser client, network services, upload pipeline, and media processing workers. The architecture must favor reliability and performance without forcing all responsibilities into one runtime.

## Decision

Djoko Studio v0.1 uses a polyglot monorepo with service-oriented boundaries.

## Consequences

- one repository is used for coordinated development
- multiple languages are allowed based on service responsibility
- Docker Compose is required for local orchestration
- the approach adds more complexity than a monolith, but it aligns better with the performance-first goals

## Alternatives considered

- a single-language monolith
- separate repositories for each service
- a platform-oriented microservices split too early

## Follow-up questions

- Which shared contracts should be generated centrally first?
- What local tooling is needed to keep the multi-service workflow simple?
