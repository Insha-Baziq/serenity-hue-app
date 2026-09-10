# ADR-0006: Keep TikTok Ads reporting in a provider-evidence cache

## Status

Accepted

## Decision

TikTok Ads reporting uses its own normalized report-row cache, sync-status record, and database lease. The Ads refresh path does not reuse TikTok Shop orders, affiliate records, or the direct-channel sync lease.

The first successful refresh requests a 90-day London-calendar baseline. Later scheduled or authenticated manual refreshes re-request the latest seven calendar days, upsert corrections by provider dimensions, and delete rows older than 90 days. A failed refresh records a safe failure state while retaining the last successful rows.

Only metrics returned by TikTok's Marketing API are stored as ad evidence. In particular, Shop revenue and purchases remain nullable when TikTok does not return those attributed metrics; ordinary TikTok Shop sales are never joined into the Ads cache.

## Consequences

- The future Ads dashboard can explain the source metric, provider currency, report date, and freshness state without exposing tokens.
- Hourly Ads refresh scheduling is independent from the five-minute Shopify/TikTok Shop reconciliation schedule.
- A provider correction is safe to replay because the normalized dimension key is unique and upserted.
- The deployment must run the additive schema migration and create the separate hourly QStash schedule.
