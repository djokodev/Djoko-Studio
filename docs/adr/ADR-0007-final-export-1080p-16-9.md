# Final export target is 1080p 16:9

## Status

Accepted

## Date

2026-06-14

## Context

Djoko Studio needs a clear quality target for the first final export format so the rendering pipeline can be designed around a concrete output.

## Decision

The first final export target is stable 1080p, 16:9, YouTube-ready video.

## Consequences

- vertical/social formats are out of scope for early MVP
- rendering pipeline must eventually support 1080p output
- live quality may adapt, but final export quality remains the priority

## Alternatives considered

- support multiple export formats immediately
- optimize for vertical-first output

## Follow-up questions

- What rendering quality checks are required before export is marked complete?
- When should additional export aspect ratios be considered?
