# 001. Make the package test loop discover every test

**Status**: complete — 2026-08-30
**Type**: AFK
**Blocks**: none

## Why

`npm test` runs only `tests/schema.test.mjs`, while `tests/labs-formula-layout.test.mjs`
is silently omitted. Agents can report green while a tracked test is never executed.

## Acceptance criteria

- `npm test` executes every committed `tests/*.test.mjs` file.
- The command fails when any discovered test fails.
- The exact command and its observed result are recorded in `docs/agents/FEEDBACK-LOOPS.md`.
- No test is weakened, deleted, or made dependent on a production credential.

## Scope

Update the package test command and its documentation only. Do not add unrelated feature
tests in this slice.

## Resolution

`npm test` now runs `node --test tests/*.test.mjs`. It was verified on 2026-08-30 with
both committed tests passing.
