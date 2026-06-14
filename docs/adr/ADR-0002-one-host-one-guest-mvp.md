# MVP limited to one host and one guest

## Status

Accepted

## Date

2026-06-14

## Context

The first version of Djoko Studio needs a narrow scope so the reliability path can be proven without multi-participant room complexity.

## Decision

v0.1 supports one host and one guest only.

## Consequences

- simpler MVP
- no multi-guest room logic yet
- multi-guest support can be revisited later

## Alternatives considered

- support multiple guests in v0.1
- allow an open-ended room model from the start

## Follow-up questions

- When should multi-guest support be reconsidered?
- What session model should future extensions build on?
