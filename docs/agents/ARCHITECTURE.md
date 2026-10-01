# ARCHITECTURE.md — module map of Serenity Hue Operations

Interfaces only. Update this file in the same commit as any public interface change.

## System shape

```text
Next pages/API routes
        ↓ session + input boundaries
Operations workspaces ←→ authenticated HTTP routes
        ↓
Repository/domain services ←→ Shopify / TikTok / Parcel2Go / QStash edges
        ↓
Turso/libSQL ← schema + migration manifest + append-only ledgers
```

## Modules

### App Router entrypoints

- **Owns**: page composition, route parameters, HTTP status/body adaptation, and the authenticated operations shell.
- **Public interface**: page components; `GET/POST/PATCH/PUT/DELETE(request, context) -> Response`; `loadVisualReport(report, range, loaders)` selects only one reporting family for a request.
- **Hides**: Next.js routing/runtime details and request parsing from domain code.
- **Depends on**: auth guard, repository/domain services, integration orchestration, shared types.
- **Tested at**: `npm run build`; route behavior has no automated coverage.
- **Depth**: shallow-but-known; mostly adapters.

### Operations workspaces and shared UI

- **Owns**: client interaction for overview, analytics, KPI reporting, orders, customers, employees, inventory, packaging, channel listings, and Labs.
- **Public interface**: exported `*Workspace(props)` components and shared UI primitives under `components/ui/`.
- **Hides**: browser state, optimistic drafts, sheets/dialogs, table presentation, and responsive presentation.
- **Depends on**: `lib/types.ts`, authenticated API routes, `app/globals.css`, shared primitives.
- **Tested at**: manual Playwright/browser review; `tests/labs-formula-layout.test.mjs` checks one CSS contract but is not in `npm test`.
- **Depth**: mixed; most workspaces are shallow-but-known, with large interaction components needing eventual decomposition.

### Repository and transaction boundary

- **Owns**: reads/writes for orders, customers, employees, packaging, channel/physical inventory, mappings, alerts, sync state, TikTok connection state, shipments, and Labs.
- **Public interface**:
  ```text
  getOrders / getOrdersPage / getOrdersForExport
  getKpiDashboard(period, { scope }) -> server-shaped dashboard with sales/product/channel metrics,
    conservative customer performance, fixed-window physical-variant restock decisions,
    complete current/previous product rows, product demand trends, refund/cancellation
    evidence, customer value bands, interactive London day/hour order-activity
    cells, all-variant stock coverage, current master/channel stock
    snapshots, and an explicit all-time period resolved from the earliest recorded order;
    visual-report scopes omit unrelated customer-history or product-inventory source groups;
    the KPI and visual-report pages use the same five-minute tagged cache with scope-aware keys
  getKpiProductComparison(spec) -> two/three-month or four-week Europe/London
    calendar comparison with refund-aware physical-product periods, deterministic
    unit/revenue winners, partial-period identity, and like-for-like latest change
  getTikTokAffiliateDashboard(period) -> affiliate-attributed KPI snapshot with
    linked-order reconciliation, explicit unreconciled GMV, sync freshness, and
    bounded calendar-bucket trends for long reporting periods
  getTikTokAffiliateComparison(spec) -> weekly or monthly creator comparison
    grouped by stable TikTok creator/product identifiers with refund-aware revenue,
    activity, best-product evidence, and a transparent non-transactional
    offer-review signal
  create/consumeTikTokAdsOAuthState; save/getActiveTikTokAdsConnection;
  getTikTokAdsConnectionState -> safe connected/configuration state without tokens
  getTikTokAdsReport(period) -> retained, provider-attributed Ads KPI view model;
    advertiser rows drive headline metrics while campaign/ad-group/ad and product
    breakdowns are exposed only when the provider returns those identifiers
  getCustomers / getEmployees / createEmployee / inviteEmployee / acceptEmployeeInvitation
  getInventory / getChannelInventory / getPhysicalInventory / getProductDetail
  create/update/deletePackagingMaterial
  applyPhysicalInventoryAdjustments / updatePhysicalProduct / add/update/deletePhysicalInventoryVariant
  getPhysicalChannelListings / savePhysicalListingMappings / savePhysicalChannelProductLink
  getLabIngredients / getLabFormulas / getLabFormula / getLabBatches / getLabBatchDetail;
    batch rows include notes plus exact created/updated timestamps
  createLabFormula / createLabIngredients / updateLabFormulaPackaging / updateLabIngredient / createLabBatch /
  updateLabBatchPackaging({ batchId, addedQuantity, actor }) -> Labs-only packaging ledger;
    optional formula fill measurement determines finished unit counts, and packaged output never mutates master on-hand
  updateLabBatchNotes({ batchId, notes, expectedUpdatedAt, actor }) -> authenticated,
    stale-safe batch note replacement with activity provenance and no inventory effect
  recordActivityEvent / recordActivityEvents / getActivityLogPage / pruneExpiredActivityLog
  ActivityEventInput / ActivityLogQuery / ActivityLogPage
  recordSyncRun / takeSyncLease / releaseSyncLease / reconcileInventoryAlerts
  ```
- **Hides**: SQL, row hydration, transactions, idempotency, migrations' data-shape assumptions, and audit writes. Activity events are written in the same transaction as staff mutations and sanitized before persistence; their seven-day cache is invalidated by the activity writer.
- **Depends on**: `lib/turso.ts`, `lib/types.ts`, integration parsers, auth-derived actor identity.
- **Tested at**: `tests/schema.test.mjs` and `tests/tiktok-ads-schema.test.mjs` cover schema constraints and Ads row correction; `tests/kpi-comparisons.test.mjs` protects the pure calendar-comparison contracts below the repository read; `tests/kpi-report-query-plan.test.mjs` protects report-to-source selection.
- **Depth**: shallow-but-known; `lib/repository.ts` is a large mixed-context module with a broad surface and is the primary deepening candidate.


### Inventory rules and audit domain

- **Owns**: physical inventory reconciliation/restoration rules, ledger semantics, and alert candidate collection.
- **Public interface**: `reconcileInventoryOperations()` and repository inventory adjustment/ledger functions.
- **Hides**: idempotent application checks, parent quantity refresh, and restoration behavior.
- **Depends on**: repository transaction/database interfaces and order/application tables.
- **Tested at**: no automated behavioral tests.
- **Depth**: shallow-but-known; rules are split between `lib/inventory-rules.ts` and a large repository module.

### Provider integrations and sync orchestration

- **Owns**: Shopify/TikTok reads and imports, TikTok Shop OAuth/inventory, TikTok Ads Marketing API OAuth/reporting, Parcel2Go shipment matching, webhooks, and manual/scheduled reconciliation.
- **Public interface**:
  ```text
  fetch/import Shopify data; fetch/store TikTok inventory, orders, and affiliate reporting
  authorize/callback handlers for TikTok Shop and TikTok Ads; webhook handlers for TikTok and Parcel2Go
  syncDirectChannels / importTikTokAffiliateReporting / refreshTikTokAdsReporting / reconcileInventoryOperations
  fetchTikTokAdsReport / normalizeTikTokAdsReportRows / aggregateTikTokAdsReportRows /
  tiktokAdsReportingWindow
  `lib/tiktok-ads-report-store`: report rows, status, token refresh persistence, retention, and Ads-only lease
  match/link Parcel2Go shipments
  ```
- **Hides**: provider payloads, pagination, cursoring, token crypto, external retries, and provider-specific identifiers from page callers. The Ads view model deliberately preserves provider report type, data level, currency, attribution metadata, and source identifiers for evidence and breakdown display. TikTok Ads credentials and OAuth state use a separate persistence namespace from TikTok Shop.
- **Depends on**: repository, `lib/turso.ts`, provider environment keys, QStash signature verification.
- **Tested at**: `tests/tiktok-ads-reporting.test.mjs` covers the official report request contract, pagination, safe errors, London windows, minor-unit money, provider attribution fields, and malformed-row omission; broader provider/webhook replay coverage remains absent.
- **Depth**: mixed; importers contain substantial hidden behavior, but cross-provider orchestration is coupled to repository state.

### Authentication and request security

- **Owns**: Better Auth configuration, session lookup/touch, page/API guards, trusted-origin mutation checks, and request rate limits.
- **Public interface**: `getCanonicalAppUrl`, `isBetterAuthConfigured`, `assertBetterAuthConfiguration`, `getTrustedOrigins`, `ensureAuthDatabase`, `getCurrentSession`, `requirePageSession`, `requireApiSession`, `takeRateLimit`, `rateLimitedResponse`.
- **Hides**: cookie/session details, auth database bootstrap, origin checks, and rate-limit bookkeeping.
- **Depends on**: Better Auth, Turso, Next headers/cookies, environment configuration.
- **Tested at**: build only; no automated auth or authorization tests.
- **Depth**: shallow-but-known; security-critical despite its small code surface.

### Persistence and schema

- **Owns**: Turso/libSQL client creation, local/remote mode selection, schema bootstrap, additive column migration, seed bootstrap, and database schema source of truth.
- **Public interface**: `hasTursoConfiguration`, `databaseMode`, `assertTursoConfiguration`, `getTursoClient`, `migrateTursoSchema`.
- **Hides**: environment resolution, local SQLite behavior, migration ordering, FTS rebuild, and physical seed initialization.
- **Depends on**: `database/schema.sql`, `database/migrations.json`, seed JSON, `@libsql/client`.
- **Tested at**: `tests/schema.test.mjs`; migration/deployment behavior is not tested against a migration fixture.
- **Depth**: deep-ish; the interface is small, but deployment coupling is a risk.

### Labs production domain

- **Owns**: gram-based ingredient calculations, batch bulk allocations, packaging increments, optional finished-unit counts, and ingredient ledger behavior.
- **Public interface**: formula/ingredient/batch repository functions plus `LabsWorkspace`, `LabFormulaWorkspace`, `LabIngredientsWorkspace`, and `LabBatchesWorkspace`; `POST /api/labs/ingredients` creates one inventory item, `POST /api/labs/ingredients/import` imports a CSV, and `DELETE /api/labs/ingredients` safely removes only unlinked ingredients from active inventory.
- **Hides**: percentage/remainder calculation, advisory ingredient deduction planning, unit-compatible fill conversion when a fill is configured, batch allocation invariants, and packaging ledger writes.
- **Depends on**: repository, Labs seed definitions, authenticated routes, shared types.
- **Tested at**: `tests/lab-production.test.mjs` protects allocation, unit conversion, and advisory ingredient deduction rules; browser verification remains needed for the authenticated side-sheet flow.
- **Depth**: mixed; pure allocation rules are isolated, while repository SQL remains broad.

## Known shallow spots

| Where | Why it is shallow | Rough cost to deepen |
|---|---|---|
| `lib/repository.ts` | Orders, inventory, mappings, sync, auth state, shipments, and Labs share one broad module and public surface. | L |
| `app/globals.css` | More than 2,000 lines of accumulated global styles mix shared tokens, page-specific rules, responsive overrides, and duplicate selectors. | L |
| `components/physical-channel-listings.tsx` and physical inventory workspaces | Large client components combine fetching, draft state, mapping/count workflows, and presentation. | M/L |
| `lib/inventory-rules.ts` + repository inventory operations | Core reconciliation behavior crosses files and has no interface-level regression suite. | L |

## Boundaries we do not cross

- App pages and route handlers never issue SQL; persistence goes through repository/domain interfaces.
- Client components never read server credentials or call provider SDKs directly.
- Physical catalogue quantities do not silently update Shopify/TikTok channel quantities.
- Ingredient calculations remain grams. Formula packaging optionally records a per-unit fill amount in grams or milliliters. Without a fill amount, Labs still records packaged bulk and leaves finished unit counts unknown. Packaging never increments finished physical stock; remaining bulk stays in Labs.
- Ledgers and historical application rows are append-only; corrections are new records.
- Provider payloads are normalized before they reach UI contracts; tokens and buyer details remain server-only.
- Authenticated mutation routes must validate the session before invoking a write.

### Remote MCP assistant connector

- **Owns**: the stateless Streamable HTTP MCP adapter, OAuth 2.1 authorization-code
  flow with S256 PKCE, the versioned dataset registry, the validated read-only query DSL,
  named staff write contracts, assistant report adapters, signed cursors, staged PII
  and write scopes, distributed rate limits, and redacted connector logging.
- **Public interface**: `/api/mcp`; the OAuth/discovery routes documented in
  `docs/REMOTE-MCP.md`; `describe_serenity_hue_data`, `query_serenity_hue`,
  `get_serenity_hue_report`, and `get_serenity_hue_freshness`; the 29 named write
  tools in `lib/mcp-write-contracts.ts`; `runAssistantWrite(principal, name, input)`;
  `executeMcpWriteOnce(db, operation, perform)`; `inviteEmployee` and the one-use
  `/invite/[token]` setup flow.
- **Hides**: OAuth token/code hashes, client registration records, database credentials,
  SQL fragments, provider payloads, synchronization behavior, and all unregistered or
  secret-bearing fields.
- **Depends on**: `lib/turso.ts` for the provider-enforced read-only database boundary,
  the primary database for OAuth/rate-limit/idempotency records, `lib/mcp-contracts.ts`,
  `lib/assistant-read-repository.ts`, `lib/assistant-write-repository.ts`, existing
  repository/domain commands, and the official MCP SDK. The write module is imported
  dynamically by the tool callback, leaving the read repository's import graph isolated.
- **Tested at**: contract/import-graph and route-coverage tests; the isolated real
  protocol run in `scripts/verify-mcp-write.mjs` exercises writes, replay, stale state,
  ledger, audit, invitation, and revocation. Live provider-client compatibility still
  requires staging checks described in `docs/REMOTE-MCP.md`.
- **Depth**: new security-critical boundary; production remains gated on database-level
  write rejection and live Claude/ChatGPT/Codex validation.
