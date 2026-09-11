# WORKFLOW.md — Serenity Hue Operations

This repository uses a seven-stage agentic-engineering lifecycle. Durable artifacts on
disk are the handoff between stateless sessions.

| Stage | Input | Output | Human involvement |
|---|---|---|---|
| 1. Design | Wish or feature idea | Shared design concept in `docs/design/` | `grill-me`; resolve decisions one at a time |
| 2. PRD | Approved design concept | `issues/prd.md` | Review stories, modules, decisions, and scope |
| 3. Backlog | PRD | `issues/NNN-*.md` vertical slices | Confirm dependency and `AFK`/`HITL` typing |
| 4. Implement | One unblocked issue | Tested reviewable diff | Use `tdd`; one issue per session |
| 5. AFK | Open AFK issues | Sandboxed branches/commits | Run only with no production credentials |
| 6. Review | Diff plus issue | Human decision or new issues | Read the diff and perform browser/QA checks |
| 7. Architecture | Accumulated code | RFC issue for deepening | Use `improve-codebase-architecture`; do not refactor during survey |

Before implementation, read `AGENTS.md`, `CONTEXT.md`, `docs/agents/ARCHITECTURE.md`,
and `docs/agents/FEEDBACK-LOOPS.md`. Before a commit, run every blocking loop. A public
interface change updates the architecture map in the same commit. Decisions that will
outlive a session become append-only ADRs in `docs/adr/`.

One session implements one issue. If work is unfinished, write a dated handoff under
`docs/agents/handoffs/` and start a fresh session rather than continuing in drift.
