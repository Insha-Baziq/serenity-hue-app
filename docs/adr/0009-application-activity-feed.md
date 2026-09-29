# 0009. Separate the short-lived application activity feed from permanent ledgers

- **Status**: Accepted
- **Date**: 2026-09-21
- **Deciders**: Project owner and implementation session

## Context

Staff need a concise view of meaningful application changes and provider sync
outcomes. The existing physical-inventory, ingredient, batch, packaging, shipment,
and reconciliation ledgers are authoritative records with different retention and
detail requirements. Reusing those ledgers as a general feed would either expose
too much operational detail or weaken their domain-specific semantics. Provider
payloads, customer details, credentials, and session activity are not appropriate
activity-feed data.

## Decision

We will store one safe, attributable `application_activity_log` row per meaningful
business operation or provider boundary outcome. Activity rows have a seven-day
expiry, indexed filter fields, structured redacted details, and optional retry
deduplication keys. Staff mutation events are inserted in the same write transaction
as the underlying mutation. The protected `/logs` workspace reads the latest retained
rows through a short-lived tagged cache; pruning is maintenance work, not a
replacement for query-time expiry filtering.

## Alternatives considered

| Option | Why not |
|---|---|
| Reuse physical/Labs/reconciliation ledgers as the feed | Those ledgers are permanent, domain-specific audit records and do not share the feed's retention or presentation contract. |
| Persist every SQL statement or provider payload | It creates noise, increases Turso usage, and risks credentials or customer data exposure. |
| Keep activity only in application memory or logs | It would not survive process restarts and would not support authenticated staff review. |
| Write one row per imported provider record | Repeated unchanged syncs would create noisy, unbounded activity. |

## Consequences

The feed is cheap to query, safe to expose to staff, and useful for operational
triage. It is intentionally not a complete forensic history: permanent ledgers and
provider-specific sync/run records remain the source of truth for detailed audit and
reconciliation. New mutation boundaries must accept an `ActivityActor` and preserve
the transaction rule.

## Notes for agents

- Keep `/logs` read-only and protected by the operations page guard.
- Filter expired rows at query time even if scheduled pruning is healthy.
- Do not put provider payloads, OAuth state, access/refresh tokens, customer contact
  details, or free-form customer-facing notes in activity details.
- Use the sync run ID plus provider operation name as the dedupe key for sync events.
