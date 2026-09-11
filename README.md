# Serenity Hue Operations

The internal operations app for combining Serenity Hue's Shopify and TikTok Shop activity. The dashboard deliberately starts with the pages the client needs now: **Orders** and **Inventory**.

## Stack

- Next.js App Router + TypeScript
- Turso / libSQL (SQLite) behind a repository layer
- Direct Shopify Admin API + TikTok Shop API connectors behind server-only routes
- QStash for a scheduled direct-channel sync job

Before Turso is connected, the app shows an honest empty state. When `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are set, the repository reads only from Turso.

## Run locally

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000/orders` or `http://localhost:3000/inventory`.

## Database setup

Create a Turso database and run `database/schema.sql` with the Turso CLI or dashboard. Add the database URL and auth token to `.env.local` / deployment secrets. Do not commit `.env.local`.

## Sync model

1. Shopify and TikTok Shop webhooks should become the primary immediate sources for their own updates.
2. A direct-channel sync runs via `POST /api/jobs/reconcile`, scheduled with QStash, to close any webhook gaps.
3. The visible **Sync now** button sends an authenticated `POST /api/sync` request. It uses the same direct-channel sync service.
4. Both scheduled and manual routes record a sync run and use a short database lease to prevent overlap.

`SHOPIFY_CLIENT_SECRET`, `TIKTOK_SHOP_APP_SECRET`, and `TURSO_AUTH_TOKEN` are only read in server files. For a client-credentials Shopify app, the Client ID and Client Secret are exchanged server-side for a short-lived Admin API token. The sync connector intentionally reports a clear configuration error until direct-channel credentials and the TikTok Shop region are configured.

## Create the QStash schedule

After deployment, create one schedule to call:

```text
POST https://YOUR_APP_URL/api/jobs/reconcile
```

with cron expression `*/5 * * * *`. The route verifies QStash signatures when both signing keys are present. Direct webhooks deliver the live path, and this job closes gaps with a five-minute reconciliation cadence for Shopify, TikTok Shop, and TikTok affiliate reporting.

TikTok Ads reporting has its own read-only cache and refresh lease. Create a second QStash schedule after deployment:

```text
POST https://YOUR_APP_URL/api/jobs/tiktok-ads
```

Use cron expression `0 * * * *` for an hourly refresh. The scheduled route fetches the configured provider-history baseline (`TIKTOK_ADS_HISTORY_START_DATE`, currently `2026-04-01`), then re-fetches the latest seven London calendar days, upserts corrected provider rows, and retains that full history for the KPI **All time** view. A signed authenticated `POST /api/tiktok-ads/refresh` is also available for an on-demand refresh.

For Serenity Hue production, `TIKTOK_ADS_ADVERTISER_ID` must point to advertiser `7171533602079997953` (`Serenity Hue1129`). The Promote-linked advertiser `7284999249782358018` is not the account used for Ads Manager reporting.
