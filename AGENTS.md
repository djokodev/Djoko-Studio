# AGENTS.md

Global instructions for Codex in this repository.

Before starting any work, always read:

- `AGENTS.md`
- `WORKFLOW.md`
- `FEATURE_TRACKER.md`
- `docs/prompts/codex_session_init.md`
- `.agents/skills/djoko-feature-implementation/SKILL.md`

These files define the standard session initialization and feature implementation workflow.

Rules:

- One feature = one branch = one pull request.
- Never push directly to `main`.
- Do not make architecture decisions without an ADR.
- Do not add major dependencies without justification.
- Keep scope small.
- Update `FEATURE_TRACKER.md` before opening a PR.
- Run available checks when relevant.
- Clearly report tests, risks, and changed files.
- If scope is ambiguous, stop and ask for clarification before coding.
- Markdown files are the canonical source of truth for product, workflow, architecture, and feature decisions.
- PDF files are human-readable exports only. Do not treat a PDF as the canonical source when a Markdown equivalent exists.
