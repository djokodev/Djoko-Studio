# Defer reverse proxy / gateway choice

## Status

Accepted

## Date

2026-06-14

## Context

The v0.1 architecture still needs room to decide the best edge and gateway shape after the core services are documented. That choice affects production routing, TLS, WebSocket proxying, and upload gateway behavior.

## Decision

No reverse proxy or gateway technology is selected yet.

## Consequences

- Nginx, Caddy and Traefik are deferred decisions
- local/dev uses Docker Compose directly
- production TLS, routing, WebSocket proxying and upload gateway concerns will be addressed later
- a future ADR must choose the reverse proxy or gateway before production deployment

## Alternatives considered

- choosing Nginx immediately
- choosing Caddy immediately
- choosing Traefik immediately

## Follow-up questions

- What production deployment model will the gateway need to support?
- Which edge responsibilities should be separated from the core services first?
