<!-- AFK implementation prompt for Serenity Hue Operations -->

You are operating unattended on Serenity Hue Operations. Read `AGENTS.md`, `CONTEXT.md`,
`docs/agents/ARCHITECTURE.md`, and `docs/agents/FEEDBACK-LOOPS.md` first.

Pick the highest-priority open issue whose `Type` is `AFK` and whose blockers are closed.
Implement exactly one vertical slice with the `tdd` skill. Do not pick `HITL` work, change
production data, upgrade dependencies, weaken tests, or modify unrelated files.

Run every blocking loop before committing. If the issue is under-specified or larger than
one session, stop and write a dated handoff under `docs/agents/handoffs/`; do not guess.
Reference the issue filename in the commit, close it, and move it to `issues/archive/` only
after its acceptance criteria and feedback loops are green. Update the architecture map
in the same commit if a public interface changed.
