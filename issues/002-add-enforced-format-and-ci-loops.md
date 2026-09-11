# 002. Add enforced formatting and continuous integration loops

**Status**: open  
**Type**: AFK  
**Blocks**: `issues/001-run-all-tests-from-the-package-script.md`

## Why

There is no formatter, format check, pre-commit hook, or CI workflow. The repository has
no shared machine-readable gate that runs the same checks agents are expected to run.

## Acceptance criteria

- A maintained formatter and a non-mutating format-check command are selected and documented.
- CI runs typecheck, the complete test command, lint, format-check, and build from a clean checkout.
- CI uses the repository's package-lock and does not require production credentials for validation.
- `docs/agents/FEEDBACK-LOOPS.md` records exact commands and CI parity.

## Human review

Confirm the formatter choice and whether a pre-commit hook is wanted before adding a new
development dependency or hook.
