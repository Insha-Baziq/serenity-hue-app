# Domain Docs

How engineering skills should consume this repository's domain documentation when exploring the codebase.

## Before exploring, read these

- `CONTEXT.md` at the repository root.
- `CONTEXT-MAP.md` at the repository root if it exists.
- Relevant ADRs under `docs/adr/`.

If any of these files do not exist, proceed silently. The domain-modeling workflow creates them lazily only when a term or decision is resolved.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
└── docs/adr/
```

## Use the glossary's vocabulary

When naming a domain concept in an issue, proposal, hypothesis, test, or implementation, use the canonical term defined in `CONTEXT.md`. If the needed concept is absent, reconsider whether an existing term applies; otherwise record the gap for the domain-modeling workflow.

## Flag ADR conflicts

If proposed work contradicts an ADR, surface that conflict explicitly rather than silently overriding it.
