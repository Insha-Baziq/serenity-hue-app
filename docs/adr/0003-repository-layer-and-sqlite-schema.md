# 0003. Keep persistence behind a repository layer and schema files

- **Status**: Accepted
- **Date**: 2026-08-27
- **Deciders**: Reconstructed from `lib/repository.ts`, `lib/turso.ts`, and `database/schema.sql`; confirm with project owner

**Reconstructed** from the codebase on 2026-08-27. The rationale below is inferred, not
recorded at the time. Correct it if you know better.

## Context

Pages, API routes, and provider imports need stable domain-shaped data while the app uses
SQLite/libSQL tables, transactions, FTS triggers, migrations, and local/remote database
modes.

## Decision

We will keep SQL and transaction orchestration behind `lib/repository.ts` and
`lib/turso.ts`, with `database/schema.sql` as the schema source of truth and
`database/migrations.json` for additive compatibility changes.

## Alternatives considered

| Option | Why not |
|---|---|
| SQL in route/page modules | Couples every caller to storage details and makes testing/migration harder. |
| ORM-generated schema only | The existing FTS triggers, seed/bootstrap behavior, and additive migration manifest need explicit SQL. |
| Separate repository per feature today | Existing behavior and transaction boundaries are centralized; splitting is a future architecture issue, not an adoption rewrite. |

## Consequences

Callers get normalized types and atomic writes. The current repository is broad and is a
known shallow/deepening candidate; schema changes require deployment review.

## Notes for agents

Keep route/UI code free of SQL. Update schema and migration artifacts together, test
fresh-database behavior, and preserve append-only ledgers.
