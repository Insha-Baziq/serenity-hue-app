# 003. Test authenticated mutations and provider event paths

**Status**: open  
**Type**: HITL  
**Blocks**: `issues/001-run-all-tests-from-the-package-script.md`

## Why

The app has authenticated writes for physical quantities, mappings, packaging, Lab
ingredients/batches, employee creation, and soft deletion, plus Shopify/TikTok/Parcel2Go
webhooks. None has an automated behavioral test at its public interface.

## Acceptance criteria

- Unauthenticated requests are proven rejected for representative page and mutation routes.
- A physical inventory adjustment test proves atomic validation and ledger attribution.
- A mapping or deletion test proves the mapping/history guard remains enforced.
- A webhook/idempotency test proves repeated provider events do not duplicate state.
- Tests use fixtures or local database boundaries and never production credentials or data.

## Human review

Review fixture scope and any test database reset strategy before implementation; this issue
touches auth, historical rows, and inventory correctness.
