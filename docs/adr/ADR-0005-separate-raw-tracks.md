# Separate raw tracks

## Status

Accepted

## Date

2026-06-14

## Context

Post-production, recovery, and synchronization all work better when participant media can be handled independently.

## Decision

v0.1 must preserve separate raw tracks:

- host audio
- host video
- guest audio
- guest video

## Consequences

- more files to manage
- more storage and processing complexity
- better post-production flexibility

## Alternatives considered

- merge participant media into a single composite track early
- store only the final rendered output

## Follow-up questions

- What metadata should tie the four tracks back to one session?
- How will raw tracks be surfaced for download and recovery?
