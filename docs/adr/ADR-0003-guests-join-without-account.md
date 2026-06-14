# Guests join without account

## Status

Accepted

## Date

2026-06-14

## Context

Remote interviews work best when guests can enter quickly. Requiring an account for guests would add friction to the main use case.

## Decision

The host needs an account, but the guest joins through an invitation link without creating an account.

## Consequences

- invitation links need access control
- guest identity must still be represented in sessions
- permissions must be carefully scoped

## Alternatives considered

- require guest accounts
- allow completely anonymous guest access

## Follow-up questions

- How should invitation links expire or be revoked?
- What guest identity metadata should be retained in the session record?
