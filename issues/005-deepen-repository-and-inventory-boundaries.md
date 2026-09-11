# 005. Propose a deep module boundary for repository and inventory rules

**Status**: open  
**Type**: HITL  
**Blocks**: `issues/003-protect-critical-mutation-and-provider-paths-with-tests.md`

## Why

`lib/repository.ts` is a 2,560-line mixed-context module with a large public surface,
while inventory behavior is split between it and `lib/inventory-rules.ts`. This makes
the most consequential quantity and mapping workflows difficult to understand and easy
to change without seeing all callers.

## Acceptance criteria

- An RFC in `issues/` identifies one proposed deep boundary and its old/new public symbols.
- The proposal preserves current transaction, ledger, and physical/channel invariants.
- The proposal identifies interface-level tests that must land before implementation.
- No production refactor is performed as part of this issue.

## Human review

Use `improve-codebase-architecture` to produce the proposal. Human approval is required
before moving persistence or inventory interfaces.
