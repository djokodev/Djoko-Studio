# Defer concrete technology stack choices

## Status

Accepted

## Date

2026-06-14

## Context

Djoko Studio needs its product and architecture constraints documented before the implementation stack is finalized.

## Decision

The project must not choose the final frontend, backend, database, storage, worker, or deployment stack yet.

## Consequences

- no premature framework decision
- future stack decisions must be made through ADRs
- architecture questions remain open for later

## Alternatives considered

- lock the stack immediately
- choose technologies before documenting product constraints

## Follow-up questions

- Which stack decision should be reviewed first when implementation planning begins?
- What criteria should future stack ADRs use for evaluation?
