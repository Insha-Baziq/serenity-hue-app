# 006. Resolve product and physical-catalogue vocabulary

**Status**: complete — 2026-08-30
**Type**: HITL
**Blocks**: none

## Why

The code and product notes use `product`, `physical product`, `master product`, and
`physical inventory item` for overlapping concepts. A wrong ruling will propagate into
future interfaces, issues, and agent decisions.

## Acceptance criteria

- The project owner chooses the canonical term for the countable catalogue parent and child variant.
- `CONTEXT.md` records the preferred term and deliberately rejected alternatives.
- `docs/agents/ARCHITECTURE.md` and future issue text use the ruling consistently.

## Recommendation

Use **physical product** for the countable catalogue parent, **physical variant** for its
child, **channel listing** for an external Shopify/TikTok listing, and reserve **master
inventory** for the older three-inventory per-variant quantity model.

## Resolution

The project owner accepted the recommendation on 2026-08-30. `CONTEXT.md` records the
canonical terms and deliberately rejected alternatives; future KPI work uses them.
