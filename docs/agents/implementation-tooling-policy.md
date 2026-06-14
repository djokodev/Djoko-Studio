# Agent Implementation Tooling Policy

## Status

Accepted

## Purpose

This policy defines how AI implementation agents, especially Codex, should use project documentation, approved skills, MCP servers, and current official technology documentation while working on Djoko Studio.

The goal is to help Codex stay aligned with the project’s accepted decisions while still using the best available implementation guidance for the task at hand.

## Source of Truth Hierarchy

When sources conflict, the higher item in this list takes precedence:

1. Project ADRs
2. Product and architecture documents
3. `AGENTS.md`
4. `WORKFLOW.md`
5. The current Codex task prompt
6. Approved skills
7. External documentation

Skills and external documentation must not override accepted ADRs, product decisions, or architecture documents.

## Skills Policy

Skills may be used to guide implementation.

Skills are helpers, not decision-makers.

Skills must not choose technologies unless the task explicitly asks for evaluation.

Skills must respect accepted ADRs and architecture documents.

Skills should be added only when useful for the current task.

Avoid installing many unrelated skills at once.

Each PR should mention which skills were used, if any.

## Approved / candidate skills

```txt
Approved / candidate skills:

- monorepo-management
  - intended use: monorepo structure, package boundaries, build/test organization, shared package conventions
  - first expected use: DS-008 Initialize polyglot monorepo structure
```

This skill may be installed with:

```bash
npx skills add https://github.com/wshobson/agents --skill monorepo-management
```

Installing the skill must be explicitly requested in the task prompt.

Codex must not install arbitrary skills without approval.

## MCP Policy

MCP servers may be used to access current documentation and resources.

Prefer read-only documentation MCPs.

MCPs that can write, mutate external systems, access secrets, or perform destructive actions require explicit approval from Djoko.

Codex must not use sensitive MCP tools unless the task prompt explicitly allows it.

If MCP was used, the PR summary must mention which MCP server or resource was used.

## Official Documentation Requirement

For implementation involving a specific technology, Codex should consult current official documentation when available.

Examples include:

- React / Vite docs for frontend scaffolding
- Go docs for Go services
- Rust / Axum / Tokio docs for Rust services
- tus protocol docs for upload
- NATS docs for eventing
- MinIO / S3 docs for object storage
- FFmpeg docs for rendering
- Docker docs for local infrastructure

When relevant, the PR summary should include a short `Docs consulted` section.

## PR Reporting Requirement

Each implementation PR should include, when relevant:

- Skills used
- MCP / resources used
- Official docs consulted
- Important assumptions
- Any deviation from project ADRs or architecture documents

## Guardrails

- Codex must not use skills or MCPs to silently change the project architecture.
- Codex must not add dependencies unless the task explicitly allows it.
- Codex must not introduce new technologies that are not already accepted or requested.
- Codex must not push directly to `main`.
- Codex must keep each PR focused on one task.
