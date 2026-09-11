# 0001. Record architecture decisions

- **Status**: Accepted
- **Date**: 2026-08-27
- **Deciders**: Reconstructed adoption convention; confirm with project owner

**Reconstructed** from the codebase on 2026-08-27. The rationale below is inferred, not
recorded at the time. Correct it if you know better.

## Context

Agents are stateless across sessions. Decisions left in chat will be re-derived or
silently violated later, while PRDs and implementation details change over time.

## Decision

We will record durable architectural decisions as append-only ADRs in `docs/adr/`.

## Alternatives considered

| Option | Why not |
|---|---|
| Decisions in PRDs | PRDs retire after their issues close. |
| Decisions in code comments | Comments lack space for alternatives and are hard to discover. |
| External wiki | It is outside the repository feedback loop and can drift. |

## Consequences

Future agents can distinguish load-bearing constraints from accidental implementation
choices. Reversals require a new record, preserving the reason trail.

## Notes for agents

Read `docs/adr/` before proposing an architectural change. Contradictions require an
explicit superseding ADR.
