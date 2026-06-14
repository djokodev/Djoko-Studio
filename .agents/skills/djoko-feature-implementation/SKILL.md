---
name: djoko-feature-implementation
description: Implementation workflow for a single Djoko Studio feature.
---

# Djoko Feature Implementation

Use this skill when implementing one Djoko Studio feature from the tracker.

## Workflow

1. Read `AGENTS.md`, `WORKFLOW.md`, and `FEATURE_TRACKER.md`.
2. Read `docs/prompts/codex_session_init.md`.
3. Read the relevant ADRs.
4. Read module-level `AGENTS.md` files when they exist.
5. Summarize the intended change before coding.
6. Confirm the requested scope.
7. Implement only one feature in the current branch.
8. Update `FEATURE_TRACKER.md` before opening a PR.
9. Run available checks relevant to the change.
10. Prepare the PR with the required review context.

## Guardrails

- Do not make architecture changes without an ADR.
- Keep scope small.
- Prefer the simplest implementation that satisfies the feature spec.

## End-of-task report

When the implementation is complete, Codex must report:

- implementation summary
- files changed
- tests / checks run
- risks / limitations
- tracker update
- PR link

## Operational reminder

At the start of an implementation task, Codex should check whether the task mentions:

- recommended skills
- official docs to consult
- MCP / resource usage

At the end of a Codex implementation task, Codex should report:

- skills used
- docs consulted
- MCP / resources used
- checks run

Codex should also:

- update the current feature to `in_review`
- report that the feature is ready for review
- not mark the feature as `merged`
- not push directly to `main`
