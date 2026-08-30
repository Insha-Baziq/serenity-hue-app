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
- **Public interface**: page components; `GET/POST/PATCH/PUT/DELETE(request, context) -> Response`.
- **Hides**: Next.js routing/runtime details and request parsing from domain code.
- **Depends on**: auth guard, repository/domain services, integration orchestration, shared types.
- **Tested at**: `npm run build`; route behavior has no automated coverage.
- **Depth**: shallow-but-known; mostly adapters.

### Operations workspaces and shared UI

- **Owns**: client interaction for overview, orders, customers, employees, inventory, packaging, channel listings, and Labs.
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
  getKpiDashboard(period) -> server-shaped dashboard with sales/product/channel metrics,
    conservative customer performance, and fixed-window physical-variant restock decisions
  getCustomers / getEmployees / createEmployee
  getInventory / getChannelInventory / getPhysicalInventory / getProductDetail
  create/update/deletePackagingMaterial
  applyPhysicalInventoryAdjustments / updatePhysicalProduct / add/update/deletePhysicalInventoryVariant
  getPhysicalChannelListings / savePhysicalListingMappings / savePhysicalChannelProductLink
  getLabIngredients / getLabFormulas / getLabFormula / getLabBatches
  createLabFormula / updateLabIngredient / createLabBatch
  recordSyncRun / takeSyncLease / releaseSyncLease / reconcileInventoryAlerts
  ```
- **Hides**: SQL, row hydration, transactions, idempotency, migrations' data-shape assumptions, and audit writes.
- **Depends on**: `lib/turso.ts`, `lib/types.ts`, integration parsers, auth-derived actor identity.
- **Tested at**: `tests/schema.test.mjs` only tests the schema's order-search trigger; repository behavior is otherwise untested.
- **Depth**: shallow-but-known; `lib/repository.ts` is a large mixed-context module with a broad surface and is the primary deepening candidate.

### Inventory rules and audit domain

- **Owns**: physical inventory reconciliation/restoration rules, ledger semantics, and alert candidate collection.
- **Public interface**: `reconcileInventoryOperations()` and repository inventory adjustment/ledger functions.
- **Hides**: idempotent application checks, parent quantity refresh, and restoration behavior.
- **Depends on**: repository transaction/database interfaces and order/application tables.
- **Tested at**: no automated behavioral tests.
- **Depth**: shallow-but-known; rules are split between `lib/inventory-rules.ts` and a large repository module.

### Provider integrations and sync orchestration

- **Owns**: Shopify/TikTok reads and imports, TikTok OAuth/inventory, Parcel2Go shipment matching, webhooks, and manual/scheduled reconciliation.
- **Public interface**:
  ```text
  fetch/import Shopify data; fetch/store TikTok inventory and orders
  authorize/callback/webhook handlers for TikTok and Parcel2Go
  syncDirectChannels / reconcileInventoryOperations
  match/link Parcel2Go shipments
  ```
- **Hides**: provider payloads, pagination, cursoring, token crypto, external retries, and provider-specific identifiers.
- **Depends on**: repository, `lib/turso.ts`, provider environment keys, QStash signature verification.
- **Tested at**: production build only; no provider contract or webhook replay tests.
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

- **Owns**: gram-based ingredients, formulas, batch calculation, atomic deductions, and ingredient ledger behavior.
- **Public interface**: formula/ingredient/batch repository functions plus `LabsWorkspace`, `LabFormulaWorkspace`, `LabIngredientsWorkspace`, and `LabBatchesWorkspace`.
- **Hides**: percentage/remainder calculation and all-or-nothing quantity validation.
- **Depends on**: repository, Labs seed definitions, authenticated routes, shared types.
- **Tested at**: no calculation or route behavior tests; one CSS layout test is outside the package test command.
- **Depth**: shallow-but-known; domain rules and UI behavior are not yet independently protected.

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
- Labs quantities are grams and do not affect finished-product or packaging stock.
- Ledgers and historical application rows are append-only; corrections are new records.
- Provider payloads are normalized before they reach UI contracts.
- Authenticated mutation routes must validate the session before invoking a write.
