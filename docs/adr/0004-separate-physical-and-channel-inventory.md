# 0004. Separate physical catalogue stock from channel listings and snapshots

- **Status**: Accepted
- **Date**: 2026-08-27
- **Deciders**: Reconstructed from `project-context.md`, schema, and inventory routes; confirm with project owner

**Reconstructed** from the codebase on 2026-08-27. The rationale below is inferred, not
recorded at the time. Correct it if you know better.

## Context

Shopify and TikTok contain divergent listings, duplicate products, and bundles. The
client's physical count source is authoritative for countable stock, while channel
quantities are fetched snapshots and mappings require exact component evidence.

## Decision

We will model physical inventory, channel listings/components, and fetched channel
inventory as distinct concerns. Uncertain mappings remain review/unmapped, and a bundle
maps to exact physical variants with multipliers.

## Alternatives considered

| Option | Why not |
|---|---|
| Use Shopify products as the master catalogue | The source contains bundle contamination and does not represent physical count groups. |
| Treat each channel listing as stock | Duplicate/relisted/bundle listings would double-count or invent stock. |
| Infer uncertain mappings | A wrong mapping can corrupt later sale-driven deductions. |

## Consequences

The model is safer and more explainable, but it needs explicit mapping workflows and
multiple tables. Channel write-back and sale-driven deduction remain separate future work.

## Notes for agents

Do not derive physical quantities from channel quantities or silently map ambiguous
listings. Treat mapping, migrations, and any deduction hook as `HITL` work.
