# Apps

This folder contains browser-facing applications in the Djoko Studio monorepo.

Each app owns a user-facing product surface and can depend on shared contracts and generated types, but not on service internals.

Monorepo rule:

- apps may depend on `packages/`
- apps must not import from `services/`
- apps should stay UI-focused and avoid backend runtime concerns
