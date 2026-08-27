# Serenity Hue Operations — Project Context

Last updated: 23 August 2026

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

## Latest authoritative implementation status — 23 August 2026

This section supersedes older “local-only”, “pending deployment”, and “not yet wired” statements elsewhere in this historical handoff where they conflict.

- The canonical physical catalogue, variant-aware stock editor, Shopify/TikTok channel listing views, and mapping dialogs are deployed at `/inventory/products`.
- Listings have exactly two types: **Individual** and **Bundle**. A bundle may contain the same physical variant more than once or multiple different physical variants. Channel listings map directly to the exact physical variants and quantities consumed per sale; they never map Shopify to TikTok.
- Mapping is variant-aware. A channel variant can map to its matching master shade/size. If TikTok has deliberately listed each shade as a separate product, each product maps to the matching physical variant. A bundle with shade-dependent components must be mapped to the appropriate shade(s), never to every variant of a product.
- Shopify listing identity is maintained by Shopify product/variant IDs, not titles. Renaming a Shopify product updates the existing row on sync; it does not create a duplicate mapping row. TikTok source links use the seller-management search URL because the API product ID is not a valid public `shop.tiktok.com/view/product/...` ID.
- Shopify product and TikTok product rows have a **View source** link. For TikTok it opens Seller Center product management pre-filled with the API product ID; a seller login is expected.
- Shopify’s current read-only app scopes are: `read_all_orders`, `read_customers`, `read_inventory`, `read_orders`, `read_products`, and `read_returns`. No Shopify write scope is required for the current inventory reconciliation.

### Shopify master-stock reconciliation — deployed and tested

- `orders.cancelled_at`, `physical_inventory_applications`, `physical_inventory_order_state`, and `shopify_refund_line_items` provide the durable Shopify order/reversal trail.
- The first reconciliation after enabling this implementation records existing Shopify orders as a **baseline**. Historic orders do not change newly counted physical stock.
- For later Shopify orders, every line must have a confirmed physical recipe before any master stock is changed. The app resolves through Shopify’s stable variant ID, expands a bundle recipe into its exact components, applies one idempotent immutable application per physical variant, updates the physical variant count, recalculates its parent total, and writes the physical ledger.
- A Shopify refund restores the exact physical components consumed by the original sale. A Shopify cancellation restores only the remaining unrefunded components. The process is idempotent, so repeated syncs cannot deduct or restore twice.
- TikTok master-stock reconciliation is now deployed alongside Shopify. New TikTok orders deduct the mapped physical components; terminal cancellations and completed physical returns restore only the affected quantity, with idempotent application rows preventing duplicate or out-of-order sync effects. Refund-only cases intentionally do not restore stock because the buyer keeps the item. Live TikTok end-to-end order testing still requires a seller-authorized connection with the after-sales scope enabled.
- Temporary test stock was deliberately seeded in production at **100 units per physical variant** (20 variants) with the note `Temporary Shopify inventory test baseline: 100 units per variant`. This is not a final client stock count.
- Live end-to-end test completed: Shopify order **#1232** (one Brow Pomade variant, £5.00, payment due later) imported after sync and changed Brow Pomade master total from **700 to 699**. After the client cancelled the order and synced again, it returned to **700**; Shopify’s own inventory also reflected the cancellation.
- The Orders UI now uses the cancellation timestamp as the final operational state. A cancelled order shows **Cancelled** in the fulfilment column/filter and **No payment due** instead of an obsolete Pending payment label. Its detail timeline ends at **Cancelled**, rather than showing a fulfilled state. This was verified on desktop and phone-sized layouts for #1232.
- Latest production deployment for this work: `dpl_H7cqtuhYdJCbnmg1bwu5tBdHuynS`, aliased to `https://serenity-hue-operations.vercel.app`.

### Client-provided physical stock counts — applied 23 August 2026

The client supplied the actual warehouse counts below. They were written through the authenticated production inventory controls with the note `Client-provided actual physical stock quantities (23 Aug 2026)` and verified on the Products and Packaging pages:

| Production row | Quantity applied |
| --- | ---: |
| Brow Follicle BioActivator | 800 |
| Encapsulated Complex Peptide Long Lash Serum (client: Lash Serums) | 1,000 |
| Snow Lift Peptide Under/Hooded Eye Serum (client: Under Eye Serum) | 1,000 |
| Serenity Hue Lab Twist Vitamin C Serum (client: Vit C) | 60 |
| Serenity Hue Perfume - The Beginning (client: Perfume) | 700 |
| Custom-Made Serenity Hue Pouch (client: Pouches) | 300 |
| Brow Spoolie (client: Spookiest, interpreted as Spoolies) | 8,000 |
| Brow Pomade — all seven colour variants | 200 each; 1,400 total |
| Brow Lamination Clay, 10g | 100 |
| Brow Baking Powder, 5g | 600 |
| Fuel & Tint Brow Tinting Mud — Warm Brown | 5,000 |
| Fuel & Tint Brow Tinting Mud — Black | 5,000 |
| Small Pouch packaging | 500 |
| Large Pouch packaging | 300 |

The client’s `File and Brow Baking Powder Large 10g` row was not applied because no matching 10g physical product exists in the catalogue. The closest catalogue row is `Fuel & Bake Brow Baking Powder`, but it is a separate **35g** product and must not be assumed to mean the client’s 10g item. Its temporary test quantity remains unchanged until the client clarifies the intended product.

### Performance optimization pass — deployed 23 August 2026

Audit finding: the app is not slow because of data volume (≈229 local orders, 38 variants, 107 TikTok SKUs, 1 MB DB). It was slow because pages made many **sequential Turso round trips**, re-seeded data **on read**, and cached nothing. Two batches were implemented and deployed together.

Production deployment for this work: `dpl_DqPDiT2ToCkQwKFQKM5Jybj2E4mp`, aliased to `https://serenity-hue-operations.vercel.app`. Validation gate (`npm run typecheck && npm run lint && npm run build`) passed; lint shows only the two known raw-image warnings. Both batches preserve existing logic — no reconciliation, ledger, mapping, or auth behaviour changed.

**Batch A — inventory-page re-seed (was the dominant cost).** `/inventory/products` used to re-run `ensurePhysicalChannelListings()` on every view (~60 unconditional `INSERT…ON CONFLICT` upserts), and it ran twice per load (Shopify + TikTok) sequentially — ~130 statements per page view. Now (`lib/repository.ts`):

- `ensurePhysicalChannelListings()` computes a cheap **signature** of its exact inputs (products/variants counts + `MAX(updated_at)`/`last_synced_at` + summed quantities; TikTok `channel_inventory` count/`synced_at`/quantity; the seed-version constants) stored in `inventory_settings` under `physical_channel_listings_signature`. If the signature is unchanged it returns immediately — no writes. It rebuilds only after a sync/refresh actually changes those inputs. The importer always bumps `updated_at`/`last_synced_at`/`synced_at`, so any real change is detected. `TIKTOK_LISTING_SEED_VERSION` must be bumped whenever `TIKTOK_LISTING_SEED` changes.
- When a rebuild does run, all upserts (and the physical seed's deletes/inserts) apply in a single atomic `db.batch(..., "write")` — one round trip, all-or-nothing.
- Both ensure functions dedupe concurrent callers via an in-flight promise, so the products page now loads its three datasets with `Promise.all` and the seed still runs exactly once.
- The seed's `ON CONFLICT` clauses never touch `mapping_status`, `listing_kind`, or the mapping tables (`physical_listing_components`, `physical_channel_product_links`), so a skipped or repeated rebuild cannot lose a manual mapping. First load after deploy does one rebuild (signature key absent), upserting existing rows as no-ops, then stays fast.

**Batch B — Orders list server-side pagination/search (#5).** The Orders page previously loaded up to 500 orders with all items/shipments/events on every visit and did search/filter/sort/pagination in the browser. Now it is server-driven:

- `lib/orders-query.ts` (new) — shared, dependency-free `OrdersQuery` type, `parseOrdersQuery`, `ordersQueryToParams`, and `ORDERS_PAGE_SIZES`; used by the page, the export route, and the workspace so parameter names/defaults/URL shape agree.
- `getOrdersPage(query)` — SQL `WHERE` (built by `buildOrdersFilter`) + `COUNT` + `LIMIT/OFFSET`, hydrating only the current page's items/deliveries. Search matches order number, customer, email, and line-item title/SKU (via `EXISTS` on `order_items`), with `ESCAPE '\'` so typed `%`/`_` are literal. Channel and fulfilment (cancelled/partial/fulfilled/unfulfilled) derivations mirror the old client filter exactly; date range is a rolling window. `getOrders()` (still used by Overview) was refactored onto the shared `hydrateOrders` helper and is unchanged in behaviour.
- `app/(operations)/orders/page.tsx` awaits `searchParams` (a Promise in Next 16) and passes the page/total/query to the workspace.
- `components/orders-workspace.tsx` is URL-driven: debounced search, filters/pagination push URL params, `useTransition` pending state; search box syncs to the URL on back/forward via render-time state adjustment (no effect). Column picker and detail sheet remain client-only.
- `GET /api/orders/export` (session-guarded, `getOrdersForExport`) streams **all** rows matching the current filters as CSV, so export still covers the full filtered set, not one page.

**Deferred perf items** (discussed, not built): **#4 in-app caching** (`unstable_cache` + tag invalidation on every mutation/sync) — safe next step; **#6 Turso embedded replica** (local read replica) — biggest infra win but needs read-after-write testing before production.

Note: a full **signed-in browser click-through was not performed** for Batch B because local/production login credentials were not available in the session; the SQL filter/pagination/export semantics were verified directly against the local database instead. A signed-in production pass of Orders (search, channel tabs, fulfilment filter, date range, 25/40/50 paging, CSV export, order detail sheet) is still recommended.

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
- Channel mapping is a visible product-management workflow: Shopify and TikTok listings map independently to the canonical physical variants. Never create a channel-to-channel mapping as the source of truth, and never auto-map a listing when its size, shade, or components are ambiguous.

## Current state of the app

The local development app runs with:

```powershell
npm run dev
```

Primary local URLs:

Every route under `app/(operations)/` is gated: the operations layout calls `getCurrentSession()` and redirects to `/login` when there is no valid Better Auth session. The root route `/` checks the session and redirects authenticated staff to `/overview`; unauthenticated visitors go to `/login`. The local change is validated but has not yet been deployed.

| Route | Current behaviour |
| --- | --- |
| `/login` | Sign-in screen (public). Split-panel layout: campaign portrait + email/password form via Better Auth. Authenticated visitors redirect to `/overview` rather than seeing the form again (local, pending deployment). |
| `/overview` | Live overview workspace: order/channel summary, inventory counts (units on hand, live/low/out-of-stock variants, packaging types), recent orders, sync status, and a **Sync now** button. No longer a placeholder. |
| `/orders` | Live Shopify (and authorized TikTok) orders table and order detail sheet. |
| `/employees` | Staff list (name, email, status, last seen) with a create-employee form. |
| `/inventory` | Redirects to `/inventory/products`. |
| `/inventory/products` | Canonical physical catalogue plus Shopify and TikTok listing-mapping views. |
| `/inventory/packaging` | Separate packaging materials table. |

`/overview` is served by the `[section]` dynamic route, which `notFound()`s for any section other than `overview`. Routes such as `/analytics`, `/products`, `/sync-health`, and `/settings` are deliberately not part of the current navigation or feature scope.

### Sidebar

The desktop sidebar now uses the shadcn Sidebar composition (provider, header, content, grouped menu, footer, nested menu, and collapse rail), customised to retain Serenity Hue’s existing Avenir Next typography, dark plum/magenta palette, logo, and navigation. This local change is validated but pending deployment. It supports a persistent expanded/collapsed preference and the `Ctrl/Cmd+B` shortcut.

The navigation contains:

1. Overview
2. Orders
3. Employees
4. Inventory — an expandable item with **Products** and **Packaging** sub-pages

A **Sign out** control sits at the bottom of the sidebar and calls `authClient.signOut()`. The existing mobile bottom navigation remains, exposing Overview, Orders, Employees, Products, and Packaging.

The old Operations section, Sync health, and Settings navigation entries were removed at the user’s request.

### Employees / staff authentication

Implemented features:

- `/employees` lists Better Auth users joined to their sessions: name, email, live `Online`/`Offline` presence, and last-active time (`components/employees-workspace.tsx`). A user is Online only when a session was updated within the last five minutes; session expiry alone never makes someone appear online. Successful page/API authentication touches the user’s session timestamp so the current user shows `Online` and `just now` while working.
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
- A checked **Remember me** option creates a persistent Better Auth session for 30 days. The root and login routes now respect that existing session: `/` and `/login` redirect authenticated staff to `/overview` (local, pending deployment).
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

### Canonical internal catalogue and bundle mapping — confirmed 21 Aug 2026

The Products page should ultimately be a canonical internal catalogue of **physical products/variants**, with each stock item represented once. Shopify and TikTok products are channel listings, not the master record:

```text
Shopify or TikTok listing → one or more internal physical variants → master quantity
```

- A normal listing maps to one internal physical variant with multiplier `1`.
- A bundle listing maps to multiple component variants and quantities through `bundle_components` (for example, Brow Serum ×1 + Under-Eye Serum ×1).
- Selling a bundle records the original channel order/listing for traceability, then decrements the underlying physical master variants — not an invented separate bundle quantity.
- Do not build Shopify↔TikTok product-to-product mappings as the primary model. Both channels map independently to the canonical internal variants, allowing unlimited channel-specific bundles, relists, product names, and deliberate display-stock differences.
- A genuinely pre-assembled, separately counted product is the only exception; it may be modelled as its own physical master item when the client explicitly confirms that stock is held separately.

This is an agreed modelling direction; the current Phase 1 screen still groups imported Shopify variants and does not yet provide the mapping-management workflow or sale-driven master decrements.

### Audit ledger (required)

Every inventory change on all three inventories writes one **immutable, append-only** row (reuse/extend `stock_movements`). Never update or delete a ledger row. Each row captures: timestamp, actor (staff user via Better Auth, or `system: shopify sale` / `system: tiktok sale`), which inventory (master/shopify/tiktok), product, change type (`manual_edit` | `sale` | `allocation_push` | `reconcile_fix` | `bundle_deduct`), before→after snapshot, delta, source reference (order id for sales), and result (ok/failed for channel pushes). Two views: per-product history timeline, and a global filterable activity feed.

### Direct channel writes (Phase 2)

The app will let staff **set the TikTok/Shopify display level directly from the app** and push it to the platform. This is deliberate, human-initiated allocation — not the rejected auto-sync loop — so it is low-risk. Requirements: edit → review → push (never silent), audit-logged, partial-failure surfaced per channel, per-warehouse (TikTok) / per-location (Shopify) targeting. **TikTok write is ready** (`seller.product.write` / "Product modify" granted and re-authorized 19 Aug 2026). **Shopify needs the `write_inventory` scope added** to the custom app before Shopify writes work. Oversell resolution policy default (last-unit race, if a common-pool sync is ever added): keep the TikTok order, cancel the unfulfilled Shopify order (TikTok penalizes seller cancellations; Shopify does not), never cancel a fulfilled/shipped order, human confirms.

### UI: Inventory → Products with a channel switch

Three views selected by a prominent switch: **Master · Shopify · TikTok**. The Shopify and TikTok views must show the **platform logo** in the heading and theme the surface to that platform's colour, so staff cannot push the wrong number to the wrong platform. Combined view shows master / Shopify shown / TikTok shown side by side with status chips. Dense Shopify-inspired tables, consistent with the existing plum/magenta palette, `Iowan Old Style` headings and `Avenir Next` body. Build phases: **Phase 1** = three-tab read + editable master + sale-driven master decrement + audit ledger; **Phase 2** = editable channel levels (push to Shopify + TikTok).

### Verified working (19 Aug 2026)

TikTok product read + write scopes are live on the production token (`seller.product.basic`, `seller.product.write`, plus order/authorization scopes). A local read via the Turso CLI confirmed 56 TikTok products / 107 SKUs / 2,575 units. Shopify holds 38 variants / 2,168 units. Only one product (copper peptide) currently matches across channels — consistent with the intentional-divergence strategy. Diagnostic endpoint `GET /api/tiktok/inventory-check` exists (session-guarded, read-only).

TikTok SKUs have **no `seller_sku`** — matching relies on `channel_mappings` (product-level, from the legacy TikTok Listing Map) plus name-based review. TikTok has many duplicate/relisted products and ~20 bundles; Shopify sells no lip range (TikTok-only).

### Catalogue direction — physical stock first (21 Aug 2026, implemented locally; pending production migration/deployment)

The Products page now reads from a **canonical physical catalogue**, separate from the Shopify-derived tables. The original `master-inf.xlsx` was discovered to be AfterShip-derived and bundle-contaminated, so it must not seed this catalogue. The client supplied `individual items.ods` (Sheet1) as the authoritative starting list: 13 individual product groups, with variants grouped under their parent product rather than listed as separate product rows. Quantities are unknown because they are maintained on paper, so each new row begins as **Not counted** rather than zero. The reset is explicit and one-time via `physical_inventory_seed_version`; Shopify and TikTok snapshots are preserved for later enrichment/mapping. The physical catalogue has its own append-only quantity audit table and an authenticated edit endpoint; it must be included in the database schema migration before the next production deploy.

The Products table is now rebuilt on the shared shadcn-style `Card` and `Table` primitives used by Orders, Customers, and Employees. It includes the reusable **Columns** picker and each row opens `/inventory/products/[productId]`. The new detail page uses the Serenity Hue palette and fonts, shows the source Shopify image where an individual source product is available, a curated product description, packaging/count metadata, and a variant-distribution table with its own Columns picker. `physical_inventory_variants` is the new child table: shade/size variants are counted below one physical product, so a pomade shade is not a separate product record. The canonical seed was advanced to `individual-items.ods-v2` to create the variant rows. This is currently local-only and still requires a reviewed Turso schema migration/deployment; do not imply it is live.

The product detail page was rebuilt against the client-supplied reference screenshot on 21 August 2026 and was reviewed through a signed-in local browser screenshot loop. Its required desktop structure is: top application bar, back control + breadcrumb, a left-side product title/shade/description/factual detail list, a wide horizontal product image on the right, horizontal tabs, then a split lower area with the variant-distribution table on the left and a `Channel mappings / Coming soon` empty-state panel on the right. Use Serenity Hue’s Iowan Old Style/Avenir Next pairing and plum/rose palette, preserve shared shadcn `Tabs`, `Card`, and `Table` primitives, and do not revert to the earlier vertical card-and-image-rail layout.

No catalogue detail value may be invented for presentation. In particular, the prior inferred Brow Pomade SKU prefix and generated per-shade SKUs were removed; absent source SKUs render as `—`. The detail page has no standalone search bar, notifications, help control, or account avatar/name because those controls do not exist on the other operations pages. The variants tab and its table are both labelled **Variants**, and the desktop table must fit without an internal horizontal scrollbar. Product imagery is intrinsic and must retain its natural aspect ratio; never letterbox, blend, or crop it. The desktop image is capped responsively at `min(420px, 22vw)` so it ends roughly at the left-hand status row rather than making the hero excessively tall; the media frame shrinks to the displayed image rather than forcing a ratio. A missing-image state may use its own minimum height. The detail page uses restrained, reduced-motion-safe CSS motion to make it feel responsive: a single page/section entrance, tactile controls and table-row feedback, and a very small non-geometric product-image hover response. Do not add decorative or continuous animation.

The resulting model is: `channel listing / bundle -> one or more physical inventory items -> master quantity`. A bundle is never a master stock item unless it is later confirmed as separately preassembled. Colour-specific brow bundles must map to the matching pomade shade, not every shade. The two master-sheet pomade placeholders with no pulled quantity are not seeded.

### Physical count updates — implemented locally (22 Aug 2026; pending production deployment)

Physical inventory is changed through one variant-aware **Update inventory** sheet. It is available from one physical product’s **Variants** table and from the physical catalogue after selecting one or more products. For a bulk update, the sheet groups selected products as collapsed expandable rows, so staff open only the product whose child variants they need to count. There are no separate set/add modes and no required reason selector: every known variant opens with its current count already in the field, while an uncounted variant stays blank (`—`). Compact **− / +** controls sit directly beside each field and adjust the proposed final count; staff can also type the final count. Blank rows stay unchanged, negative counts are rejected, and each variant can only appear once in a save.

`PATCH /api/inventory/physical` is session-guarded and validates the entire batch. `applyPhysicalInventoryAdjustments()` writes variant quantities atomically, updates the parent product’s cached total/known state, and appends a physical-inventory ledger entry for each counted or changed variant. The ledger reference records the optional note and variant id; it does not alter Shopify or TikTok quantities. The product catalogue now includes selection checkboxes and a bulk action for any selected subset. All product rows are collapsed by default; their chevron opens an inline variant breakdown, an update action for that one product, and a link to the full detail page. Both the list and detail page update in place after a successful save.

This was reviewed in a freshly signed-in local browser session using Playwright: catalogue selection, a two-product bulk review, an individual seven-variant product sheet, and a full temporary-row save from 0 → 3. The simplified follow-up UI was also reviewed: inline expansion/collapse and the single ± count control with no reason selector. The temporary QA inventory row, its audit row, and temporary QA account were removed after verification; client inventory remained unchanged. `npm run typecheck`, `npm run lint` (two existing raw-image warnings only), and `npm run build` passed.

### Master product maintenance — implemented and deployed (23 Aug 2026)

The master product detail page now supports **Edit name** and **Add variant**. New variants are created with no counted stock (`0`, unknown) so staff must count them explicitly before they affect the parent total. Product names are unique among active master products.

**Delete** is available only when the product has no channel mapping. The UI disables it and explains the requirement when mappings exist; the session-guarded `DELETE /api/inventory/physical/products/[productId]` route repeats the check against both product-level links and variant component mappings, then soft-deletes the item (`active=0`) so history is retained. Product-name edits use `PATCH` and variant creation uses `POST` on the same route. The live deployment is `dpl_GChKeuThQbjAPzNQvddGfUdbsEsb`.

Variants now have row-level **Edit** and delete controls. Variant renames/SKU edits use `PATCH /api/inventory/physical/variants/[variantId]`; deletion uses `DELETE` on that route, is blocked when the exact variant is mapped, and keeps at least one variant per product. Variant removal is soft (`active=0`) so physical-count history remains intact. The additive variant archive-column migration runs automatically on the first production database connection after deploy.

### Channel listing mapping — implemented locally (22 Aug 2026; pending production migration/deployment)

The Products page now has three prominent inventory views: **Master inventory**, **Shopify inventory**, and **TikTok inventory**. The two channel views use recognisable Shopify and TikTok marks and show the real channel listings in a searchable table. Each row shows the platform-reported listing quantity, whether the listing is a single item or bundle, a compact **View mapping** action, its mapping state, and an action to edit the mapping. **View mapping** opens a dialog with the mapped physical components and per-sale multipliers, preventing multi-item bundles from making the table rows tall. Shopify quantities come from its imported variant inventory; TikTok quantities aggregate TikTok's fetched live SKU quantities by exact TikTok product id. Neither value is derived from the physical mapping. TikTok has an authenticated **Refresh TikTok quantities** control; an unavailable local TikTok connection renders `Not fetched`, never a made-up zero.

The editor is a session-guarded shadcn sheet with a searchable catalogue of individual physical variants. Staff can select one or more components, set each per-sale quantity with direct ± controls or a numeric field, remove a component, save a mapping, or clear it. `physical_channel_listings` stores the channel listing identity and `physical_listing_components` stores the durable one-to-many mapping; `PATCH /api/inventory/physical-mappings` validates and saves the full mapping atomically. Manual edits are preserved when the app reloads its initial channel-listing seed.

Initial mappings were made from current Shopify product pages and the recorded seller-authorised TikTok listing audit at `docs/live-tiktok-shopify-crosswalk-2026-08-21.md`: 38 Shopify variants and 24 active TikTok listings. Direct products and explicitly described bundles are mapped to their real physical components. Listings whose exact component/shade/size cannot be proved are intentionally marked **Needs review** or **Not mapped** rather than guessed (six current TikTok listings, including shade-unspecified pomade/brow bundles, Fuel & Tint without a shade, and the uncertain TikTok baking-powder size). These mappings are the foundation for later sale-driven master decrements; the decrement hook itself is not yet enabled.

The workflow was reviewed in a signed-in local browser using Playwright: Master, Shopify, and TikTok views render; the editor search finds the matching physical variants; and an unchanged All-Day Hold & Grow mapping saved and reloaded with its four components intact. `npm run typecheck`, `npm run lint`, and `npm run build` must be rerun before any deployment.

### Previous build status — Phase 1 shipped and deployed (as of 20 Aug 2026)

The three-inventory control is **built, deployed to production, and live** at `/inventory/products`. What exists in code now:

- **Schema** (`database/schema.sql`, auto-applied on boot): `master_inventory` (per-variant physical count), `channel_inventory` (cached fetched Shopify/TikTok levels), `inventory_ledger` (immutable append-only audit trail — never updated/deleted).
- **Repository** (`lib/repository.ts`): `getChannelInventory()` (three-inventory view: master + Shopify from `variants.available_quantity` + TikTok from `channel_inventory`, plus sold 7d/30d, lead time, packaging), `setMasterQuantity()` / `setMasterQuantities()` (batch, audit-logged), `recordInventoryLedgerEntry()`.
- **TikTok inventory** (`lib/tiktok-inventory.ts`): `fetchTikTokInventory()` (read products/SKUs/warehouse qty) and `storeTikTokInventory()` (caches into `channel_inventory`, backfills `channel_mappings.external_variant_id`).
- **API routes**: `POST /api/inventory/master` (batch master save, session-guarded, staff-attributed), `POST /api/inventory/refresh-tiktok` (fetch + cache live TikTok levels), `GET /api/tiktok/inventory-check` (diagnostic).
- **UI** (`components/channel-inventory-workspace.tsx` + `.ci-*` styles in `app/globals.css`): the Products page. Three-channel switch (Master / Shopify / TikTok) with real platform logos and per-channel colour theming so staff cannot push to the wrong channel. One summarized row per product (summed Master/Shopify/TikTok, lead time, packaging). Clicking a row opens a **detail sheet** with product analytics (master/shopify/tiktok totals, sold 7d/30d, days of cover), an **allocation bar** (how physical stock is split across channels, with over-allocation warning), and a **per-variant breakdown** with editable master steppers. Master edits stage as local drafts; header **Save/Discard** commits all drafts in one batch (recording to the ledger only on Save). Pagination 25/40/50. The audit ledger is written server-side but NOT surfaced in the UI (client asked to keep it backend-only for now).
- **Master seeded from the client's Dropbox master Excel** (`Master Inventory - Serenity Hue.xlsx`, "Master Inventory" sheet): 32 variants matched by `Shopify Variant ID`, 1,750 units loaded into production `master_inventory`, each recorded in the ledger as `Import from Excel`. Source column used: `Current Shopify Qty (units)`.

Channel sub-labels are plain ("Physical stock" / "Shopify stock" / "TikTok stock") — the earlier "scarcity level" wording was removed at the client's request.

### Not yet built (Phase 2 and open items)

- **Editable channel levels + push to platforms.** Shopify/TikTok columns are currently READ-ONLY (fetched). Phase 2 = edit the TikTok/Shopify display level in the app and push it out. TikTok write is ready (`seller.product.write` granted); **Shopify needs the `write_inventory` scope added to the custom app** before Shopify writes work. Must be edit → review → push, audit-logged, partial-failure surfaced per channel.
- **Sale-driven master decrement.** The rule "every sale on either channel deducts master by 1" is specified but NOT yet wired — needs to hook order webhooks / the reconciliation import, apply once per order via `inventory_order_applications` (baseline anchor so only sales after a master recount deduct), and handle bundle multipliers via `bundle_components`.
- **TikTok column population in production:** requires clicking "Refresh from TikTok" on the TikTok tab (works only in production where TikTok creds exist); not yet auto-run on schedule.
- **Repeatable master import** (in-app upload of the Excel/CSV for future recounts) — currently a one-time CLI seed.
- **Oversell-resolution policy** (last-unit race): default recommendation is keep the TikTok order / cancel the unfulfilled Shopify order (TikTok penalizes seller cancellations), never cancel a shipped order, human confirms. Not built.

### Deployment / access notes for this work

- Production DB is Turso `serenity-hue-operations-uk` (Ireland). The Turso CLI is authenticated inside WSL at `~/.turso/turso` (account `insha-khan`); use `turso db show serenity-hue-operations-uk --url` + `turso db tokens create …` to read/write production directly.
- Deploys via `npx vercel --prod --yes` from the repo (project linked in `.vercel/`). Live at `https://serenity-hue-operations.vercel.app`.
- Validation gate before every deploy: `npm run typecheck && npm run lint && npm run build` (all must pass).

## Current non-goals

- AfterShip integration
- Dropbox as the active database
- Analytics page
- Products page outside the Inventory navigation
- Settings and Sync health pages
- Live TikTok claims before TikTok API integration
- Image storage in the database
- Automatic public deployment

## Labs — ingredient and batch production (implemented locally, 25 August 2026)

Labs is a separate operational domain for production ingredients. It does not link to, allocate from, or alter the finished-product catalogue or packaging inventory.

- `/labs` presents the four client-supplied formula cards: 7-Peptide Lash Serum, 20% THD Vitamin C Serum, Strong Honey-Coffee Overnight Brow Jelly, and Streamlined Under-Eye Serum.
- `/labs/[formulaId]` shows the ratio sheet and opens a **Create batch** review dialog. Staff enter a unique batch number and target batch weight in grams. The app calculates fixed `% w/w` ingredient requirements, calculates only `q.s. to 100` water as the remaining percentage, and never invents quantities for plain `q.s.` pH-adjustment ingredients.
- Confirmation atomically creates the batch, deducts each calculated ingredient, creates batch-ingredient snapshots, and appends immutable ingredient-ledger rows. It blocks an uncounted or insufficient ingredient before any deduction occurs.
- `/labs/ingredients` is the standalone gram-based ingredient inventory. Staff record physical quantity and optional reorder point; every update is recorded in the immutable ledger.
- The source formulas are transcribed in `lib/labs-formulas.ts`. Do not substitute ingredients, merge similarly named source ingredients, or infer missing formulation percentages without explicit client approval.
