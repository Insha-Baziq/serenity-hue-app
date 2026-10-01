# 011 — Allow batch packaging without formula fill size

Type: HITL
Status: complete

## Scope

Allow staff and the Labs MCP write tool to record a packaged bulk amount before a
formula's per-unit fill size is configured. Preserve the batch size limit and keep
finished unit counts unknown until a fill size exists.

## Acceptance criteria

- [x] The batch packaging form accepts positive amounts when formula fill size is unset.
- [x] The server and repository accept the same write without bypassing batch limits.
- [x] The packaging ledger records the amount and actor without inventing finished units.
- [x] When a fill size exists, unit compatibility and whole-unit validation remain enforced.
- [x] Required local feedback loops pass.

## Verification

- The optional-fill migration preserves existing ledger rows and accepts new rows with an unknown finished-unit count.
- `npm test` (99 passed), `npm run typecheck`, `npm run lint`, and `npm run build` pass.
