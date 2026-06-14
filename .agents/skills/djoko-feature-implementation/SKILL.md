---
name: djoko-feature-implementation
description: Implementation workflow for a single Djoko Studio feature.
---

# Djoko Feature Implementation

Use this skill when implementing one Djoko Studio feature from the tracker.

## Workflow

1. Read `AGENTS.md`, `WORKFLOW.md`, and `FEATURE_TRACKER.md`.
2. Read the relevant ADRs.
3. Read module-level `AGENTS.md` files when they exist.
4. Summarize the intended change before coding.
5. Confirm the requested scope.
6. Implement only one feature in the current branch.
7. Update `FEATURE_TRACKER.md` before opening a PR.
8. Run available checks relevant to the change.
9. Report changed files, tests, and risks clearly.

## Guardrails

- Do not make architecture changes without an ADR.
- Keep scope small.
- Prefer the simplest implementation that satisfies the feature spec.
