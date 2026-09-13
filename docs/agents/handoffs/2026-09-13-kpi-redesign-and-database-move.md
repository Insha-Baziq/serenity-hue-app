# Handoff — KPI redesign and production database move

Date: 13 September 2026
Repository: `Serenity Hue App` (Serenity Hue Operations)
Branch: `main`. Four commits are **local only and deliberately unpushed**.

Paste everything below into the receiving assistant.

---

## Your task

You are picking up work on **Serenity Hue Operations**, a private internal
operations app for a beauty brand selling through Shopify and TikTok Shop. It is
not a storefront and not a CRM. A previous session completed a large KPI module
redesign and moved the production database. Read this whole document before
touching anything, then work only on what the user asks for.

## Stack and rules you must not break

- Node.js, **Next.js 16 App Router**, React 19, strict TypeScript, npm.
- Persistence is **SQLite/libSQL via Turso**, reached through a repository layer.
- Auth is **Better Auth** (email + password). The app fails closed.
- Feedback loops: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
  There is no formatter — do not claim formatting is enforced.

Non-negotiables from `AGENTS.md`:

1. Never issue SQL from pages or route adapters; go through the repository/domain layer.
2. Keep physical inventory, channel listings, packaging and Labs ingredients distinct.
3. Guard authenticated page/API mutations and preserve audit/history semantics.
4. Tests target public module interfaces; critical-path changes use red-green-refactor.
5. One issue per session; record interface changes in `docs/agents/ARCHITECTURE.md`.
6. Never commit credentials, `.env.local`, production data or unreviewed migrations.

Read `CONTEXT.md` before naming domain concepts, `DESIGN.md` before any UI decision,
and treat `project-context.md` as the source of product truth. `project-context.md`
was updated on 12 September 2026 and now contains the authoritative version of
everything summarised here.

## What the previous session did

### 1. KPI module rebuilt (commit `8bb854a`)

The `/kpis` module was replaced wholesale with a design produced in Claude Design
Studio. It went from three views to **seven tabs**: Overview, Products, Channels,
Customers, TikTok Affiliates, TikTok Ads, Restock — all sharing one period control.

- Files: `components/kpis-workspace.tsx`, `components/kpis-workspace.module.css`,
  `app/(operations)/kpis/page.tsx`.
- Every figure is server-provided. Where a provider withholds a value the cell says
  so ("Not supplied") rather than substituting a zero. Sections the reporting layer
  cannot produce were omitted rather than illustrated with invented data.
- The design's "All channels" pill was **dropped** in favour of a working custom date
  range, because no channel filter exists in the data layer and faking one would be a
  decorative control that does nothing.
- The design's "Export" button was **dropped** — there is no KPI export route yet.
- **Restock is surfaced for the first time.** `buildKpiDashboard` had always computed
  `dashboard.restock`, but nothing rendered it.
- Colours resolve to existing tokens in `app/globals.css` (`--plum`, `--ink`, etc.),
  never repeated hex literals. Fonts are Source Serif 4 (display) and DM Sans (body),
  already wired as `--type-display` / `--type-sans`.

`lib/kpi-dashboard.ts` gained **`previousTrend`**: a real preceding-period series
bucketed on the same interval as `trend`, so the comparison line on the sales chart
aligns point for point. It is empty for all-time ranges, which have no preceding
period. Product and top-customer caps were raised (50 / 20) to serve the new tabs.

The user has since reviewed the redesign in a browser and approved it.

### 2. Production database was blocked, diagnosed, and replaced

Mid-session, production started returning 500s on every authenticated page. Cause:

```
BLOCKED: Operation was blocked: SQL write operations are forbidden
```

Turso had blocked **writes** on the old free-tier organisation (10M rows/month
exceeded; reads were still fine at 393M of 500M). Because Better Auth writes on
every session check, every authenticated route failed.

**Root cause was write amplification, not data volume.** On a 21 MB database the
scheduled sync was rewriting ~2,590 unchanged rows per run, ~2,350 of them TikTok
affiliate videos — `tiktokAffiliateAnalyticsWindow` pulls a 90-day window every run
and re-upserted every video, almost all long settled. At 288 runs/day that is
~22M writes/month.

The user chose to move to a **new Vercel Marketplace Turso resource** rather than pay
for a plan. That is now production:

- Resource `serenity-hue-operations`, `store_THa30fMtd19MgZIc`, region `dub1`,
  **Starter plan ($0)**, owned by the `serenity-hue` Vercel team.
- 41,568 rows across 52 tables copied; row counts verified identical on both sides.
- Credentials are **integration-managed**. `vercel integration resource connect
  serenity-hue-operations` writes `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` into the
  project so they rotate without hand-editing. Do not set them manually.
- The old `serenity-hue-operations-uk` database and the standalone `insha-khan` Turso
  account are no longer used.

### 3. Usage reduction (commits `efc89fd`, `7e59da1`)

- **`lib/sql-upsert.ts`** is new. `changedColumns(table, columns)` builds the
  `DO UPDATE ... WHERE` clause so a provider row is only written when a payload column
  actually differs. Applied to `tiktok_affiliate_videos`, `tiktok_affiliate_orders`,
  `shipments`, `shipment_events`. Covered by `tests/sql-upsert.test.mjs` against a real
  SQLite engine.
- **`sync_runs` is pruned to 30 days** on completion. It grew by two rows per run
  forever and both readers only take the latest row.
- **QStash cadence reduced from 5 to 30 minutes.** Schedule `serenity-hue-shopify-sync`
  → `*/30 * * * *`, targeting `POST /api/jobs/reconcile`. Managed outside the repo in
  QStash. A separate hourly TikTok Ads schedule was left untouched.
- `importRecentParcel2GoShipments()` now returns early when the provider returns no
  shipments, instead of reading every order for nothing.

Net effect: writes ~22M → ~0.3M/month, reads ~880M → ~150–180M/month, against free
tier limits of 10M and 500M.

## Landmines — read before touching sync, migration or upsert code

These were discovered the hard way. Violating any of them causes silent data loss or
corruption, not a loud failure.

- **`channel_inventory` must stay unguarded.** Its staleness sweep runs
  `DELETE ... WHERE synced_at < ?`. If you add a `changedColumns` guard, unchanged rows
  stop bumping `synced_at` and the sweep deletes them. There is a comment in
  `lib/tiktok-inventory.ts` saying so — leave it there.
- **Never include bookkeeping stamps in a change guard.** `imported_at`, `updated_at`
  and `last_synced_at` are set to "now" every run, so including them makes the guard
  always true and silently restores the original problem. `tests/sql-upsert.test.mjs`
  pins this case.
- **`order_search` is a self-contained FTS5 virtual table.** Its five
  `order_search_{data,idx,content,docsize,config}` shadow tables are internal. Never
  create or copy them directly — create the virtual table and copy through its own
  columns. Create the 6 triggers **after** loading data or they double-insert.
- **Turso enforces foreign keys, and tables copy in schema order, not dependency
  order.** Any bulk load must go through libSQL's `migrate()` (foreign keys disabled),
  not `batch()`.
- **Do not date-bound the Parcel2Go candidate query** (see below).

## Outstanding work, highest value first

### A. Parcel2Go candidate scan reads every order

`importRecentParcel2GoShipments()` loads **all** channel orders (5,339 today) on every
sync to match ~25 deliveries. It scales linearly with order count forever.

The obvious fix is wrong. `findParcel2GoOrderMatch()` resolves an exact Parcel2Go
**reference** *before* it applies the 45-day booking window
(`MAX_DAYS_BETWEEN_ORDER_AND_BOOKING` in `lib/parcel2go-matching.ts`). Only the
name/address path is date-constrained. Bounding the query by date would silently stop
linking older orders that match by reference.

Correct fix: two queries whose union is passed to the unchanged matcher —
(1) an indexed lookup for orders matching the extracted reference keys, and
(2) a date-windowed set for the evidence match. Needs tests around **both** paths
before it ships.

### B. Login form misreports outages as bad credentials

When the database is unreachable, `components/login-form.tsx` shows *"These details
were not recognised"*. During this session that made a Turso outage look like a wrong
password and cost significant debugging time. It should distinguish an auth failure
from a server error.

### C. Deferred: in-app caching

`unstable_cache` plus tag invalidation on mutations and syncs, for read-heavy pages.
Listed as a safe next step in `project-context.md`. Not currently needed for quota —
reads sit at roughly a third of the limit after the cadence change.

### D. Credentials hygiene

`LOCAL-VERIFICATION-CREDENTIALS.md` (git-ignored) says its credentials are local-only
and must not be used on deployed environments. The user reports the same credentials
also work in production. If that is true the file is misleading and the local password
is effectively a production password. Either change one of them or correct the file.

## Current state

Commits on `main`, **local only, not pushed** (the user asked for this explicitly so
the work stays revertible):

```
7e59da1  perf: cut sync read volume and record the database move
efc89fd  perf: stop rewriting unchanged provider rows on every sync
8bb854a  feat: rebuild the KPI module on the approved reporting design
ffe09af  chore: checkpoint before KPI module redesign
```

`ffe09af` is a checkpoint of the entire working tree taken before the redesign, so the
redesign can be reverted cleanly.

Production is deployed and healthy on the new database; `/` correctly redirects to
`/login`, and `/kpis` is session-guarded. First deployment of this work was
`dpl_ESJav1KSnPDJ8BW5gvVz1Ere6JL6`, aliased to
`https://serenity-hue-operations.vercel.app`.

Working tree is clean. `skills-lock.json` and `.claude/` were added to `.gitignore` —
the Vercel CLI drops them in when installing the Turso integration.

## Commands you will need

Validation gate — all must pass before any deploy:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Deploy (this project uses a dedicated Vercel profile for the client's account — never
the default profile, and never a GitHub deployment flow):

```bash
npx vercel --prod --yes --global-config "C:\Users\baziq\AppData\Local\vercel-profile-shabina-khan"
```

## Conventions worth repeating

- Money is stored in **minor units (pence)**; `formatMoney` divides by 100.
- Reporting is **Europe/London** throughout.
- Shopify and TikTok display stock **intentionally differ** — TikTok is kept low as a
  deliberate scarcity play. Never build anything that forces the two channels equal.
- Channel listings map independently to canonical physical variants. Never
  Shopify↔TikTok. Ambiguous shade/size mappings stay "Needs review" rather than guessed.
- Every inventory change writes an immutable, append-only ledger row.
- TikTok Ads reporting uses advertiser ID `7171533602079997953`, and
  `TIKTOK_ADS_HISTORY_START_DATE=2026-04-01` must stay set in local and production.
