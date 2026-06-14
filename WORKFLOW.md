# Workflow

## Roles

- Djoko is the product owner and final decision maker.
- GPT is the mentor, planner, architect, and reviewer.
- Codex is the implementation agent.

## Process

1. Planning happens before implementation with Djoko and GPT.
2. Codex reads `AGENTS.md`, `WORKFLOW.md`, `FEATURE_TRACKER.md`, `docs/prompts/codex_session_init.md`, and the relevant ADRs before coding.
3. Codex implements only one feature per session.
4. One feature = one branch = one pull request.
5. Codex keeps the scope small and asks for clarification when the feature is ambiguous.
6. Codex runs available tests and checks relevant to the change.
7. Codex updates `FEATURE_TRACKER.md` before opening the pull request.
8. Codex creates the pull request on the same branch and includes the required review context.
9. GPT reviews the pull request and requests changes when needed.
10. Codex fixes requested changes in the same branch.
11. GPT re-reviews the updated pull request.
12. Djoko gives explicit final approval before merge.
13. GPT must never merge without Djoko's explicit approval.
14. Merge only after approval.

## Post-merge tracker sync

- Before a PR is opened, Codex should mark the current feature as `in_review`.
- Codex must not mark its own feature as `merged` before the PR is actually merged.
- After a PR is merged, the person or tool that performed the merge is responsible for ensuring `FEATURE_TRACKER.md` is updated.
- The merged feature must be marked as `merged`.
- The tracker update must happen immediately after merge or before starting the next feature.
- GPT must not merge a PR without Djoko's explicit approval.
- Codex must never push directly to `main`.

Controlled exception:

- If GPT performs the merge and has write access, GPT may perform a limited post-merge tracker sync directly on `main`, but only after Djoko explicitly approved the merge, only for `FEATURE_TRACKER.md`, only to mark the merged feature as `merged`, with a clear commit message, and with no application code changes.
- If GPT cannot write directly to `main`, Djoko performs the tracker sync manually.
