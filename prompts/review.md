<!-- Fresh-session review prompt for Serenity Hue Operations -->

Review the supplied diff for Serenity Hue Operations as a fresh reviewer. Read the issue,
`CONTEXT.md`, `docs/agents/CONVENTIONS.md`, and `docs/agents/ARCHITECTURE.md`.

Check every acceptance criterion, security boundary, empty/first-run state, public
interface change, vocabulary term, and regression test. Do not modify code or issues.

Output exactly:

```text
## Verdict
BLOCK | COMMENT | APPROVE-WITH-NITS

## Acceptance criteria
- [x] criterion — satisfied by <file:line>
- [ ] criterion — NOT satisfied

## Blocking findings
1. <file:line> — what is wrong — what would happen in production

## Non-blocking findings
1. <file:line> — what and why

## Questions for the human
- <ambiguous calls that need taste, not rules>
```
