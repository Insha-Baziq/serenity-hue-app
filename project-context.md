# Serenity Hue Operations — Project Context

Last updated: 18 August 2026

This file is the working handoff for the Serenity Hue internal operations app. Read it before making product, data-model, integration, or UI decisions.

## Product purpose

Serenity Hue is a client’s Shopify store with a TikTok Shop channel. This app is a private management workspace, not a customer-facing storefront and not a traditional sales CRM.

The goal is to give the client one reliable place to:

- see orders from sales channels;
- view Shopify-led product inventory and variant stock;
- track consumable packaging stock separately;
- export orders and inventory data as CSV/Excel-compatible files;
- eventually identify low stock and reorder risk from sales velocity and lead times.

The client previously had a static HTML dashboard generated with Claude. It was fragile and relied on scheduled scripts plus AfterShip/Dropbox files. The replacement app must be functional, direct, and deliberately modest in scope rather than recreate every speculative feature.

## Agreed product decisions

### Data sources

- **Shopify is the live inventory source.** The app imports actual Shopify orders, variants, quantities, customers, order lines, payment state, and fulfilment state.
- **Parcel2Go is the live delivery-data provider.** It is not a sales channel. The app imports Parcel2Go's 25 most recent deliveries, their courier/service details, actual tracking milestones, estimated delivery date, and Parcel2Go tracking-page URL.
- **TikTok Shop uses seller OAuth and the signed Open API.** Once the seller authorizes the app, the service imports authorized-shop orders and order lines into the shared order model. OAuth tokens remain server-side in Turso and are refreshed automatically.
- **AfterShip has been removed from the intended architecture.** Do not add it back unless the user explicitly changes that decision.
- The old Dropbox spreadsheet and the supplied Excel workbook are historical/source material only. They are not the new system of record.
- The app will export data rather than write ongoing data back to Dropbox/Excel.

### Database and deployment

- The app uses a **local libSQL/SQLite database** at `data/serenity-hue.db` during development and a hosted **Turso/libSQL** database in production. The production database is `serenity-hue-operations-uk` in Turso's Ireland (`aws-eu-west-1`) region.
- The repository layer switches to Turso when `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are present; no app code should need a large rewrite for that move.
- The production app is deployed to Vercel via the CLI at `https://serenity-hue-operations.vercel.app`, with server functions configured for Vercel's Dublin (`dub1`) region.
- Supabase, Neon, Cloudflare D1, and Cloudflare hosting are not selected.
- Upstash QStash EU is intended to call the production reconciliation endpoint every 30 minutes (`*/30 * * * *`). The manual **Sync now** control remains available for an immediate refresh.

### Inventory philosophy

- Shopify inventory is the live stock baseline for Shopify products and variants.
- The current app groups variants by product on the Products page, but the product detail sheet shows the individual variant distribution.
- Packaging materials are separate operational inventory (pouches, boxes, etc.), not a section at the bottom of the Products page.
- Lead time and stock-cover calculations are useful future alert inputs, but the user asked not to clutter the current Inventory UI with attention cards, top-level alerts, or analytics.
- TikTok mapping is not currently a visible product-management feature. Do not add mapping cards, filters, columns, or invented TikTok status indicators until there is a real TikTok integration and an agreed workflow.

## Current state of the app

The local development app runs with:

```powershell
npm run dev
```

Primary local URLs:

Every route under `app/(operations)/` is gated: the operations layout calls `getCurrentSession()` and redirects to `/login` when there is no valid Better Auth session. The root route `/` also redirects to `/login`.

| Route | Current behaviour |
| --- | --- |
| `/login` | Sign-in screen (public). Split-panel layout: campaign portrait + email/password form via Better Auth. |
| `/overview` | Live overview workspace: order/channel summary, inventory counts (units on hand, live/low/out-of-stock variants, packaging types), recent orders, sync status, and a **Sync now** button. No longer a placeholder. |
| `/orders` | Live Shopify (and authorized TikTok) orders table and order detail sheet. |
| `/employees` | Staff list (name, email, status, last seen) with a create-employee form. |
| `/inventory` | Redirects to `/inventory/products`. |
| `/inventory/products` | Product-level inventory table with variant detail sheet. |
| `/inventory/packaging` | Separate packaging materials table. |

`/overview` is served by the `[section]` dynamic route, which `notFound()`s for any section other than `overview`. Routes such as `/analytics`, `/products`, `/sync-health`, and `/settings` are deliberately not part of the current navigation or feature scope.

### Sidebar

The desktop sidebar contains:

1. Overview
2. Orders
3. Employees
4. Inventory — an expandable item with **Products** and **Packaging** sub-pages

A **Sign out** control sits at the bottom of the sidebar and calls `authClient.signOut()`. The mobile bottom navigation exposes Overview, Orders, Employees, Products, and Packaging.

The old Operations section, Sync health, and Settings navigation entries were removed at the user’s request.

### Employees / staff authentication

Implemented features:

- `/employees` lists Better Auth users joined to their sessions: name, email, `active`/`offline` status (any unexpired session), and last-seen time (`components/employees-workspace.tsx`).
- The create-employee form posts to `POST /api/employees`, which requires a valid session, validates name/email/password, and calls `createEmployee()` in `lib/repository.ts` to insert a `user` + credential `account` row with a hashed password.
- There is no self-service sign-up in the UI; new staff are created by an already-authenticated user, or bootstrapped from `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` on first request (see Authentication below).

### Orders page

Implemented features:

- actual Shopify and authorized TikTok Shop orders;
- search by order, customer, email, product, or SKU;
- channel, date, and fulfilment filters;
- configurable visible columns using the Shopify-inspired column picker;
- pagination with 25, 40, or 50 rows per page; default 50;
- CSV export;
- order detail sheet;
- **Open in Shopify** from the detail sheet for Shopify orders, using the stored source order ID and store domain;
- Parcel2Go delivery section in the order detail sheet. It shows actual courier/service, Parcel2Go reference, current delivery status, milestones, collection/estimated-delivery dates, and an **Open in Parcel2Go** tracking link when a delivery is linked;
- Parcel2Go deliveries are linked automatically when the source reference matches, or when the booking date and independent recipient/delivery-address signals form one unambiguous channel-order match. The UI shows the safe matching basis without exposing any new customer data;
- manual **Sync now** button.

The TikTok Shop tab shows live imported rows only after seller authorization succeeds. It remains empty, rather than showing invented sample data, until that point.

### Products page

Implemented features:

- grouped product table based on live Shopify variants;
- configurable column picker and 25/40/50-row pagination;
- search and inventory filters for All products, Reorder now, and Low stock;
- configurable columns for variants, Shopify quantity, sales, lead time, packaging, units per box, on-hand boxes, and status;
- product detail sheet containing variant-by-variant stock distribution;
- CSV export;
- manual **Sync now** button.

### Mobile behaviour

- Phone-sized screens use touch-friendly summary cards for Orders, Products, and Packaging instead of horizontally scrolling data tables.
- Search, filters, pagination, exports, and detail sheets remain available on mobile; column customization remains a larger-screen table feature.
- A fixed bottom navigation gives direct access to Overview, Orders, Products, and Packaging on phones.

Removed from the visible Products page:

- TikTok mapping column;
- TikTok mapping filter;
- TikTok mapping values from the CSV export and serialized page data;
- the packaging block that used to sit below the table;
- the “Recent operational movements” section;
- the disabled “Adjust stock” action;
- inventory-attention summary cards and top-page alert strips.

### Packaging page

Implemented features:

- dedicated route: `/inventory/packaging`;
- searchable and filterable table for packaging materials;
- status filters: All materials, In stock, Low stock, Empty;
- configurable visible columns;
- CSV export;
- columns for quantity on hand, reorder point, lead time, last updated, and status.

Important cleanup completed on 15 August 2026:

- The legacy CSV included a final **instructional sentence**: “Fill in current stock…”
- The legacy importer had treated that sentence as a real packaging material, so it appeared as a row in the app.
- That exact row was removed from the local database.
- `lib/legacy-inventory-import.ts` now skips packaging rows whose title begins with `Fill in current stock`, so it cannot be recreated by a future legacy import.

## Integrations and sync

### Shopify — working locally

Relevant files:

- `lib/shopify.ts`
- `lib/shopify-import.ts`
- `lib/sync.ts`
- `app/api/sync/route.ts`

The Shopify client-credentials flow is server-side only:

1. The app exchanges the Shopify client ID and secret for an Admin API token.
2. The importer pages through all orders and all product variants via Shopify GraphQL API version `2026-07`.
3. Products, variants, orders, and order items are upserted into the current database.
4. The inventory reconciliation code runs after the import.

Local Shopify credentials are already present in `.env.local`. Never paste, commit, log, or copy their values into this file or any tracked source file.

### Parcel2Go: working locally and deployed

Relevant files:

- `lib/parcel2go.ts`
- `lib/parcel2go-import.ts`
- `app/api/webhooks/parcel2go/route.ts`
- `app/api/orders/[orderId]/parcel2go/route.ts`

The Parcel2Go client-credentials flow is server-side only. `PARCEL2GO_CLIENT_ID`, `PARCEL2GO_CLIENT_SECRET`, and `PARCEL2GO_API_BASE_URL` are set in the local ignored environment file and Vercel Production environment; never add their values to tracked files.

- The importer calls `GET /api/me/orders/detail`, which currently returns the account's 25 recent deliveries.
- The response contains courier/service, parcel/transaction IDs, tracking milestone timestamps, estimate, a `tracking-page` link, booking/collection dates, and delivery-recipient details. Recipient email, phone, name, and address are used in memory only to make high-confidence matches and are not copied into the delivery tables.
- The importer links a delivery automatically only when an exact source reference is found or when the recipient and delivery-address evidence agrees with a Shopify order in the 45-day booking window. Ties and weak matches remain unlinked; never show delivery status against an uncertain order.
- `POST /api/webhooks/parcel2go` is deployed and deliberately excluded from Basic Auth. It verifies the Parcel2Go HMAC-SHA256 signature, rejects stale/duplicate events, and is active when Parcel2Go is configured with the deployed webhook URL and its matching secret.
- The scheduled 30-minute reconciliation refreshes Parcel2Go deliveries once the deployed code is active. Webhooks will prompt an additional refresh once configured.

### TikTok Shop

TikTok is implemented as a direct server-side integration:

- `/api/tiktok/authorize` starts seller authorization with a short-lived, HttpOnly state cookie and a server-side state record.
- `/api/tiktok/callback` exchanges the authorization code and stores rotating access and refresh tokens only in `tiktok_connections`.
- `lib/tiktok.ts` signs every Open API request, refreshes expiring access tokens, and never exposes a credential to the browser.
- `lib/tiktok-import.ts` enumerates authorized shops, pages through order updates, retrieves full order details in batches of 50, and normalizes them into `orders` and `order_items` with source `tiktok`.
- The first history import is written as an inventory baseline, preventing historic TikTok sales from changing current stock. Later orders are eligible for existing inventory operations only when a confirmed one-to-one mapping has multiplier `1`.
- TikTok webhooks are signature-checked, deduplicated, and acknowledged immediately. The 30-minute reconciliation imports the authoritative order state, which covers lost, duplicated, or out-of-order webhook events.

### Manual and scheduled sync

- `POST /api/sync` runs a manual direct-channel reconciliation and is used by the **Sync now** button.
- `POST /api/jobs/reconcile` is the scheduled endpoint. It verifies QStash signatures only when both QStash signing keys are configured.
- Sync leases in the database prevent overlapping reconciliation jobs.
- QStash schedule `serenity-hue-shopify-sync` should run in the EU region with cron `*/30 * * * *`, targeting `POST /api/jobs/reconcile`. Its signature is verified with the configured QStash signing keys. The schedule is managed outside this repository in QStash; after changing its cadence, verify the schedule record and one successful production invocation.

## Authentication (Better Auth)

Staff authentication uses **Better Auth** with the email + password provider. It replaced the old Basic Auth flow as the primary access control.

Relevant files:

- `lib/auth.ts` — server Better Auth instance, backed by the same libSQL/Turso database via `LibsqlDialect`.
- `lib/auth-client.ts` — browser client (`createAuthClient`) used for sign-in and sign-out.
- `lib/auth-guard.ts` — `getCurrentSession()` (page guard) and `requireApiSession()` (API guard).
- `app/api/auth/[...all]/route.ts` — Better Auth request handler.
- `app/login/page.tsx` + `components/login-form.tsx` — sign-in UI.

Key behaviour:

- `isBetterAuthConfigured()` always returns `true`, so the app **fails closed**: production uses `BETTER_AUTH_SECRET`, local development falls back to a non-production secret constant. There is no mode where auth is silently off.
- Sign-up is disabled unless `AUTH_ALLOW_SIGN_UP=true`. Staff are added through the Employees page instead.
- `ensureAuthDatabase()` runs on session checks. If `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` are set and no matching user exists, it bootstraps a single admin `user` + credential `account`. Remove those env values after the first admin exists.
- `trustedOrigins` includes the resolved app URL, the Vercel production URL, and localhost. The cookie prefix is `serenity-hue`.
- The operations layout redirects unauthenticated visitors to `/login`; API routes that mutate data (e.g. `POST /api/employees`) call `requireApiSession()` and return 401 without a session.
- `proxy.ts` no longer issues a Basic Auth challenge — it is a pass-through, and its matcher excludes `/login`, `/api/auth`, `/api/jobs/reconcile`, `/api/webhooks/parcel2go`, and the TikTok callback/webhook routes. `INTERNAL_APP_USERNAME` / `INTERNAL_APP_PASSWORD` remain only as a documented temporary fallback and are not the active mechanism.

## Data model

The schema is in `database/schema.sql`. Key tables are:

| Table | Role |
| --- | --- |
| `products` | Product identity and Shopify product metadata. |
| `variants` | Shopify variant quantity, SKU, lead time, packaging type, and units per box. |
| `orders` / `order_items` | Normalized sales data from Shopify and authorized TikTok Shop connections. |
| `shipments` / `shipment_events` | Parcel2Go delivery records and their provider-supplied tracking milestones, separate from Shopify fulfilment. |
| `packaging_materials` | Separate physical packaging counts and reorder details. |
| `bundle_components` | Rules for bundles and their component inventory/packaging association. |
| `stock_movements` | Ledger-style records of observed order and packaging movements. |
| `inventory_order_applications` | Ensures a given order is not applied more than once. |
| `inventory_alerts` | Backend alert candidates; deliberately not surfaced in the current UI. |
| `channel_mappings` | Legacy/possible future channel mapping data; not current live TikTok state. |
| `sync_runs`, `sync_leases`, `webhook_events` | Operational sync bookkeeping. |
| `user`, `session`, `account`, `verification` | Better Auth staff accounts, sessions, and credentials. Quoted table names because they are SQL keywords. The Employees page reads `user` joined to `session`. |

### Inventory reconciliation caveat

`lib/inventory-rules.ts` currently establishes existing orders as a baseline on first reconciliation so historical orders are not immediately double-applied to the operations ledger. Later imported orders produce stock movement records, and fulfilled orders can consume matching packaging material.

Treat this logic carefully. It is not a replacement for Shopify’s authoritative inventory counts, and it should be reviewed with the client before enabling any direct inventory-writing workflow.

## Legacy source material

The original Claude-generated project lives outside this app at:

```text
C:\Users\baziq\OneDrive\Documents\Freelance\Shabina Khan\CRM
```

Useful legacy inputs include:

- `data/master_inventory.csv`
- `data/tiktok_listing_map.csv`
- `data/bundle_components.csv`
- `data/packaging_materials.csv`
- `data/Master Inventory - Serenity Hue.xlsx`
- `dashboard/index.html`

`POST /api/development/import-legacy` imports legacy operational metadata in development only. It can populate packaging, bundles, and old channel-mapping data. It must not be enabled in production.

The old `tiktok_listing_map.csv` is static mapping metadata. It is **not** proof of a live TikTok Shop connection.

## Branding and UI

- The Serenity Hue colour direction was accepted by the user.
- The original official logo remains untouched at `public/serenity-hue-logo.jpg`.
- A transparent black-wordmark version for the light UI is at `public/serenity-hue-logo-black.png`; the official pink monogram is retained.
- That black-wordmark asset is currently used by `components/sidebar.tsx` and `app/icon.png` is the matching favicon.
- `app/icon.png` is the current Next.js favicon convention asset.
- The login screen uses its own assets in `public/`: `serenity-hue-login-logo.png` (panel logo) and `serenity-hue-login-portrait.png` (campaign image). White/enhanced wordmark variants (`serenity-hue-logo-white.png`, `serenity-hue-logo-enhanced.png`) also exist for contrast contexts.
- Do not redesign or alter the official logo unless asked again.

The user prefers clean, dense, Shopify-inspired tables over generic dashboard cards. Avoid adding promotional text, vague operational “punch lines,” arbitrary status cards, or fake analytics.

Existing local shadcn-style primitives live in `components/ui/` and use Radix where relevant. Reuse them instead of adding another UI system unnecessarily.

## Security and deployment notes

- `.env.local` is local-only and ignored. It contains development Shopify configuration and must never be committed.
- Parcel2Go credentials are server-only environment values. Do not prefix them with `NEXT_PUBLIC_`, commit them, or expose them to the browser.
- `.env.example` lists the required deployment variables without values, including the Better Auth values (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_ALLOW_SIGN_UP`, optional `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD`).
- Staff access is now enforced by **Better Auth** (see the Authentication section), not Basic Auth. Keep `BETTER_AUTH_SECRET` server-side and at least 32 random characters in every deployed environment.
- `proxy.ts` is a pass-through; `INTERNAL_APP_USERNAME` / `INTERNAL_APP_PASSWORD` are only a temporary fallback and should be removed once Better Auth is confirmed active in production.
- The scheduled QStash route, the Better Auth handler, the login page, the TikTok callback/webhook, and the Parcel2Go webhook are excluded from the proxy matcher so they remain reachable; the sensitive endpoints protect themselves with signature verification or their own session checks.
- Vercel SSO deployment protection is disabled because app-level Better Auth protects staff pages while allowing the QStash and webhook routes to run.

## File map

```text
app/
  page.tsx                             Redirects to /login
  login/page.tsx                       Sign-in screen (public)
  (operations)/
    layout.tsx                         Session guard + app shell
    orders/page.tsx                    Orders route
    employees/page.tsx                 Employees / staff route
    inventory/products/page.tsx        Products route
    inventory/packaging/page.tsx       Packaging route
    inventory/page.tsx                 Redirect to Products
    [section]/page.tsx                 Overview workspace (section === "overview")
  api/auth/[...all]/route.ts           Better Auth handler
  api/employees/route.ts               Create-employee endpoint (session-guarded)
  api/sync/route.ts                    Manual sync
  api/jobs/reconcile/route.ts          QStash scheduled sync
  api/tiktok/authorize|callback|webhook  TikTok OAuth + webhook
  api/webhooks/parcel2go/route.ts      Parcel2Go webhook
  api/orders/[orderId]/parcel2go/route.ts  Order delivery detail
  api/development/import-legacy/route.ts  Dev-only legacy import
  icon.png                             Favicon

components/
  overview-workspace.tsx               Overview UI
  orders-workspace.tsx                 Orders UI
  employees-workspace.tsx              Employees UI + create form
  login-form.tsx                       Sign-in form
  inventory-workspace.tsx              Products inventory UI
  packaging-workspace.tsx              Packaging UI
  sidebar.tsx                          Main navigation + sign out
  status-pill.tsx                      Order/payment status pills
  product-art.tsx                      Product thumbnail art
  table-column-picker.tsx              Reusable visible-column control
  sync-button.tsx                      Manual sync control

lib/
  auth.ts                              Better Auth server instance + admin bootstrap
  auth-client.ts                       Better Auth browser client
  auth-guard.ts                        Session guards for pages and API routes
  shopify.ts                           Shopify token + GraphQL client
  shopify-import.ts                    Shopify data import/upsert
  parcel2go.ts / parcel2go-import.ts / parcel2go-matching.ts  Parcel2Go client, import, order matching
  tiktok.ts / tiktok-import.ts         TikTok signed client + importer
  sync.ts                              Single sync entrypoint
  turso.ts                             Local libSQL / future Turso client
  repository.ts                        Database reads, employees, sync bookkeeping
  format.ts                            Money/date formatting helpers
  types.ts                             Shared domain types
  inventory-rules.ts                   Operational reconciliation rules
  legacy-inventory-import.ts           Development-only import of old CRM CSVs
```

## Validation expectations

After code changes, run:

```powershell
npm run typecheck
npm run lint
npm run build
```

Use `apply_patch` for source edits. Preserve unrelated user changes and never reset or broadly delete the working tree.

## Parcel2Go webhook configuration

In Parcel2Go's API credential settings, configure the webhook URL as `https://serenity-hue-operations.vercel.app/api/webhooks/parcel2go` and use the matching secret stored in Vercel Production as `PARCEL2GO_WEBHOOK_SECRET`. Do not put that value in a tracked file. Parcel2Go's current account feed is limited to the 25 most recent deliveries.

## Remaining work, in priority order

1. Keep refining the Products and Packaging tables only when the client gives specific feedback.
2. Decide the exact TikTok Shop API access path and obtain real credentials; then implement the direct adapter and test order/stock normalization.
3. Confirm the client’s desired stock-alert rules before surfacing alerts on Overview or elsewhere.
4. Decide whether packaging counts should be editable in-app and, if so, implement an audited adjustment workflow instead of a cosmetic button.
5. Monitor the 30-minute direct-channel reconciliation and keep the TikTok importer incremental as order volume grows.
6. Keep the Turso database and Vercel function region aligned with the client's location if the hosting region changes.
7. Confirm the Vercel plan is suitable for commercial client use before long-term production operation.
8. Better Auth staff authentication now replaces Basic Auth. Remaining: verify it end-to-end in production, remove the `INITIAL_ADMIN_*` bootstrap and `INTERNAL_APP_*` fallback env values once the first admin exists, and add roles/permissions if staff responsibilities diverge.

## Three-inventory model (master + channel allocation) — agreed design, not yet built

This is the agreed direction as of 19 August 2026, confirmed directly with the client. It supersedes the earlier idea of a single "common pool that keeps both channels equal" — that idea is **rejected** because it would break the client's deliberate TikTok scarcity strategy.

### Why the channels intentionally differ

The client keeps TikTok stock **deliberately low** as an algorithm play: low displayed stock signals scarcity/demand and TikTok pushes the listing. So a large Shopify-vs-TikTok quantity gap is **intended**, not an error to reconcile. Any feature that forces the two channels to the same number is wrong.

### The three inventories

| Inventory | Source | Who changes it | Notes |
| --- | --- | --- | --- |
| **Master** | Maintained inside this app (seeded from the client's Dropbox master Excel) | Staff set it manually; app auto-decrements on every sale | The real physical warehouse count. NOT pulled from Shopify or TikTok. |
| **TikTok** | Fetched from TikTok Shop Open API | Client's scarcity level (set on TikTok, or — Phase 2 — from this app) | A deliberately low display level. |
| **Shopify** | Fetched from Shopify Admin API | Client's allocation (set on Shopify, or — Phase 2 — from this app) | Usually a fuller allocation. |

### Core rules

- **Setting a channel display level does NOT deduct master.** Allocating 100 to Shopify and 10 to TikTok leaves master unchanged. Channel levels are independent display numbers, not withdrawals from master.
- **Every sale on either channel deducts master by the sold quantity** (× bundle multiplier for bundles). A Shopify sale → Shopify shown −1 (Shopify does this) and master −1 (app does this). A TikTok sale → TikTok shown −1 (TikTok does this) and master −1 (app does this).
- **Master is a manual anchor + auto-decrement.** When staff set master (e.g. 500) from the Excel, only sales *after* that point deduct it. Re-counting resets the anchor. Past/baseline orders must not retroactively deduct — reuse the existing baseline mechanism (`inventory_order_applications`) and per-order idempotency so each order applies once.
- **Guardrail alert:** warn when `master < TikTok shown + Shopify shown`, i.e. the channels together promise more than physically exists (oversell risk).

### Matching (the linchpin)

TikTok SKUs carry **no `seller_sku`** (confirmed 19 Aug 2026 — all 107 TikTok SKUs returned empty). So Shopify↔TikTok↔master matching cannot use SKU codes. It must use an app-maintained mapping (extend `channel_mappings`) plus name-based matching, analyst-reviewed. TikTok also has many **duplicate/relisted** products and ~20 **bundles**; bundles deduct multiple master lines via `bundle_components`. The client's master Excel structure determines the master table shape — obtain it before finalizing the schema.

### Audit ledger (required)

Every inventory change on all three inventories writes one **immutable, append-only** row (reuse/extend `stock_movements`). Never update or delete a ledger row. Each row captures: timestamp, actor (staff user via Better Auth, or `system: shopify sale` / `system: tiktok sale`), which inventory (master/shopify/tiktok), product, change type (`manual_edit` | `sale` | `allocation_push` | `reconcile_fix` | `bundle_deduct`), before→after snapshot, delta, source reference (order id for sales), and result (ok/failed for channel pushes). Two views: per-product history timeline, and a global filterable activity feed.

### Direct channel writes (Phase 2)

The app will let staff **set the TikTok/Shopify display level directly from the app** and push it to the platform. This is deliberate, human-initiated allocation — not the rejected auto-sync loop — so it is low-risk. Requirements: edit → review → push (never silent), audit-logged, partial-failure surfaced per channel, per-warehouse (TikTok) / per-location (Shopify) targeting. **TikTok write is ready** (`seller.product.write` / "Product modify" granted and re-authorized 19 Aug 2026). **Shopify needs the `write_inventory` scope added** to the custom app before Shopify writes work. Oversell resolution policy default (last-unit race, if a common-pool sync is ever added): keep the TikTok order, cancel the unfulfilled Shopify order (TikTok penalizes seller cancellations; Shopify does not), never cancel a fulfilled/shipped order, human confirms.

### UI: Inventory → Products with a channel switch

Three views selected by a prominent switch: **Master · Shopify · TikTok**. The Shopify and TikTok views must show the **platform logo** in the heading and theme the surface to that platform's colour, so staff cannot push the wrong number to the wrong platform. Combined view shows master / Shopify shown / TikTok shown side by side with status chips. Dense Shopify-inspired tables, consistent with the existing plum/magenta palette, `Iowan Old Style` headings and `Avenir Next` body. Build phases: **Phase 1** = three-tab read + editable master + sale-driven master decrement + audit ledger; **Phase 2** = editable channel levels (push to Shopify + TikTok).

### Verified working (19 Aug 2026)

TikTok product read + write scopes are live on the production token (`seller.product.basic`, `seller.product.write`, plus order/authorization scopes). A local read via the Turso CLI confirmed 56 TikTok products / 107 SKUs / 2,575 units. Shopify holds 38 variants / 2,168 units. Only one product (copper peptide) currently matches across channels — consistent with the intentional-divergence strategy. Diagnostic endpoint `GET /api/tiktok/inventory-check` exists (session-guarded, read-only).

## Current non-goals

- AfterShip integration
- Dropbox as the active database
- Analytics page
- Products page outside the Inventory navigation
- Settings and Sync health pages
- Live TikTok claims before TikTok API integration
- Image storage in the database
- Automatic public deployment
