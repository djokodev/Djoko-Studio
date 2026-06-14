# React, TypeScript and Vite for the web studio

## Status

Accepted

## Date

2026-06-14

## Context

The recording studio experience is browser-heavy and must prioritize fast iteration, responsive UI behavior, and strong type safety. The frontend does not require a server-rendered application for v0.1.

## Decision

The web studio uses React, TypeScript and Vite.

## Consequences

- the frontend is optimized for browser-heavy recording UI
- there is no server-side rendering requirement for the studio
- Next.js is not selected for the recording studio v0.1
- Next.js may be reconsidered later for marketing or other web surfaces

## Alternatives considered

- Next.js
- plain JavaScript without TypeScript
- a framework-free frontend

## Follow-up questions

- Which shared types should be generated for the browser first?
- What UI state boundaries should be standardized across the studio screens?
