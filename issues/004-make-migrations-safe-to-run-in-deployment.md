# 004. Make deployment migrations observable and safe

**Status**: open  
**Type**: HITL  
**Blocks**: none

## Why

`vercel.json` runs `npm run db:migrate && npm run build`. The migration path performs
schema changes, rebuilds the order FTS table, seeds physical inventory when empty, and
may encrypt stored TikTok tokens. These are production data operations without a tested
migration fixture or explicit rollback/runbook.

## Acceptance criteria

- A disposable local migration fixture exercises a fresh database and an already-migrated database.
- Migration versioning is idempotent and its verification output is captured.
- Data-changing operations and their failure behavior are documented for deployment review.
- The deployment runbook names required environment keys without storing their values.
- No production database is used by automated tests.

## Human review

Required before touching migration behavior or running any migration against Turso.
