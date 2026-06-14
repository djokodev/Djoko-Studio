# Go API and signaling services

## Status

Accepted

## Date

2026-06-14

## Context

Djoko Studio needs backend services that handle request/response traffic and live connection coordination with good operational simplicity. The core API and signaling layer are network-oriented concerns.

## Decision

The core API and signaling service use Go.

## Consequences

- Go is used for network-oriented backend services
- signaling uses WebSocket
- the API handles users, studios, sessions and auth
- the exact REST/gRPC split can be refined later

## Alternatives considered

- implementing the backend services in Rust
- implementing the backend services in TypeScript
- using a single backend runtime for all services

## Follow-up questions

- Which endpoints should be exposed over REST versus gRPC first?
- What shared session model should the API and signaling service agree on?
