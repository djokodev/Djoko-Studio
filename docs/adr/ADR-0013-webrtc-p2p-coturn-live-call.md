# WebRTC P2P with coturn for live call

## Status

Accepted

## Date

2026-06-14

## Context

Djoko Studio v0.1 needs a live call path for one host and one guest without introducing unnecessary media server complexity. Connection reliability still matters, especially across NATs and weaker networks.

## Decision

v0.1 uses WebRTC P2P for one host and one guest, with coturn for TURN/STUN relay.

## Consequences

- no SFU is used in v0.1
- the media server surface stays smaller for the MVP
- coturn is included to improve connection reliability
- SFU can be reconsidered later for multi-guest or advanced live scenarios

## Alternatives considered

- an SFU-based architecture
- direct media handling without TURN/STUN relay
- a custom media relay service

## Follow-up questions

- What TURN capacity and deployment baseline are required for reliable MVP testing?
- What connection-failure telemetry should be captured from the browser?
