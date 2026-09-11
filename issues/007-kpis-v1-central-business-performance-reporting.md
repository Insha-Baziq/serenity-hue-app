# 007. KPIs V1 — central business-performance reporting

**Status**: open  
**Type**: HITL  
**Triage**: ready-for-agent  
**Blocks**: `issues/001-run-all-tests-from-the-package-script.md`, `issues/006-resolve-product-vocabulary.md`

## Problem Statement

Staff can see live operational records, but cannot answer the recurring business questions
that the client calls KPIs: how product sales are trending, which physical products and
channels drive sales, whether customers are new or repeat buyers, and which stock needs
a purchasing decision soon. The current operational views do not provide a coherent,
trustworthy reporting surface.

The solution must remain an authenticated, serverless Vercel application. It must use
existing operational data in Turso rather than introducing a data warehouse, external
analytics service, client-side tracking product, or separate backend. It must be
especially careful with historical money, refunds, physical stock, mappings, and
customer identity so it never fills gaps with made-up precision.

## Solution

Add a central **KPIs** destination directly below Overview. Staff can choose a
Europe/London reporting period (7, 30, 90 days, or a custom period up to 365 days) and
view net merchandise sales, paid orders, AOV, net units, a daily trend, leading physical
products, a direct Shopify/TikTok comparison, new/repeat customer performance, top
customers, and a focused Restock planning action queue.

The page is server-rendered from a single server-side KPI view model built from existing
operational records. It shows when its data was last current and refreshes after
successful imports or relevant edits. It is deliberately not a static low-stock list:
Restock planning predicts stockout and reorder-by dates only for mapped physical
variants with complete, sufficient data.

## User Stories

1. As an authenticated staff member, I want a KPIs destination directly below Overview, so that business performance is easy to find without leaving operations.
2. As an authenticated staff member, I want every KPI calendar boundary to use Europe/London, so that staff see the same day regardless of their own browser timezone.
3. As an authenticated staff member, I want to select the trailing 7, 30, or 90 calendar days, so that I can inspect recent trading quickly.
4. As an authenticated staff member, I want to choose a custom inclusive date range up to 365 days, so that I can investigate a specific trading period without creating an unbounded query.
5. As an authenticated staff member, I want preset ranges to include today and make that partial-day context clear, so that the report remains useful during the working day.
6. As an authenticated staff member, I want each headline KPI compared with the immediately preceding interval of equal length, so that change has a fair baseline.
7. As an authenticated staff member, I want net merchandise sales to exclude VAT/tax and delivery charges, so that product performance is not distorted by pass-through amounts.
8. As an authenticated staff member, I want refunds to reduce revenue and units on the date the refund was issued, so that each period reflects the adjustment that actually occurred in it.
9. As an authenticated staff member, I want partial refunds to reduce only the affected money and units where source data identifies them, so that valid sales are not erased.
10. As an authenticated staff member, I want paid, non-cancelled order count reported separately from revenue, so that commercial activity remains visible even when net sales change.
11. As an authenticated staff member, I want AOV defined from net merchandise sales and the reported paid-order count, so that I can compare order value across periods and channels.
12. As an authenticated staff member, I want to see net units sold, so that product demand is visible independently of price.
13. As an authenticated staff member, I want a daily trend that can switch between net merchandise sales and order count, so that I can distinguish demand volume from revenue movement.
14. As an authenticated staff member, I want the top ten physical products ranked by net units sold, so that I can see the products customers are actually choosing.
15. As an authenticated staff member, I want physical-variant sales rolled up to their parent physical product while retaining the variant context where needed, so that the product view is readable without hiding stock risk.
16. As an authenticated staff member, I want each leading product to show net revenue and Shopify/TikTok contribution, so that I can understand both value and source demand.
17. As an authenticated staff member, I want unmapped or uncertain sales lines visibly represented as unassigned rather than silently attached to a product, so that the KPI page preserves mapping integrity.
18. As an authenticated staff member, I want Shopify and TikTok compared side by side for net merchandise sales, orders, AOV, and net-unit share, so that I can assess channels without confusing their independent stock positions.
19. As an authenticated staff member, I want customer counts to include only people who bought during the selected period, so that the date filter has a meaningful effect.
20. As an authenticated staff member, I want a customer with one recorded qualifying order classified as new and a customer with more than one classified as repeat, so that repeat performance follows the client's simple business definition.
21. As an authenticated staff member, I want customer identity to use exact normalized email first and phone plus a compatible normalized name only when email is absent, so that household phone numbers do not merge unrelated buyers.
22. As an authenticated staff member, I want orders with no safe customer identity to remain in sales and order KPIs but outside customer counts, so that the system does not invent a buyer relationship.
23. As an authenticated staff member, I want the five top customers by net spend, order count, and most recent purchase, so that I can recognize valuable repeat buyers.
24. As an authenticated staff member, I want Restock planning to calculate demand per physical variant from trailing-90-day, cross-channel net units, so that a fast-selling shade or size is not concealed by its parent product.
25. As an authenticated staff member, I want Restock planning to use current counted stock, stored supplier lead time, and a seven-calendar-day safety buffer, so that reorder-by dates lead expected stockouts.
26. As an authenticated staff member, I want Restock planning to show only mapped physical variants that have counted stock, supplier lead time, at least 30 days since first paid sale, and positive net demand, so that every displayed forecast is defensible.
27. As an authenticated staff member, I want products missing forecast inputs, with insufficient history, or with zero/negative demand omitted entirely, so that the action queue is not padded with speculative dates.
28. As an authenticated staff member, I want only overdue items and items requiring reordering within the next 30 days shown, ordered by urgency, so that Restock planning is a decision queue rather than a passive stock snapshot.
29. As an authenticated staff member, I want each restock row to show counted stock, forecast stockout, reorder-by date, and the affected variant, so that I can act without mistaking parent-product availability for variant availability.
30. As an authenticated staff member, I want a quiet “data current as of” timestamp, so that I know whether a newly completed source sync is reflected.
31. As an authenticated staff member, I want KPI data to refresh after relevant imports and edits without manually refreshing or running an analytics job, so that the report remains serverless and operationally current.
32. As an authenticated staff member, I want zero, empty, and unavailable states to be explicit, so that I never mistake missing data for a measured zero.

## Implementation Decisions

- Add a single server-side KPI aggregate/forecast interface that accepts a validated reporting period and produces the complete, domain-shaped KPI view model. This is the primary boundary between persistence rules and the KPIs workspace; page composition must not query SQL directly.
- Reuse the established authenticated operations shell and existing design language. KPIs is a reporting workspace, while Overview remains the concise live operations view.
- The only global page control in V1 is the reporting period. There is no global channel filter: the business view remains cross-channel, channel comparison stays side by side, and Restock planning cannot be accidentally constrained to one channel.
- Enforce a maximum inclusive custom period of 365 calendar days. Calculate the prior comparison from the directly preceding interval of equal calendar length.
- Treat the current business day as included in presets. The page must make freshness and partial-day context visible.
- Define net merchandise sales as product-line money after discounts and refunds, excluding VAT/tax and delivery charges. Keep those excluded amounts out of V1 entirely rather than creating a finance/reconciliation section.
- Attribute refunds to their processed date. Apply source-supported line-level partial refunds to both product revenue and net units. Never reinterpret a cancellation as a paid sale.
- Rank products by net units. Roll mapped sales to the countable physical-product parent; retain a clearly visible unassigned state for source lines that have no defensible mapping. Never infer a channel-listing or bundle relationship.
- Present channel performance as a compact comparison table rather than a decorative pie chart. It must respect the existing invariant that channel listings/snapshots and physical inventory are separate concerns.
- Classify new/repeat customers based on the customer's total recorded qualifying orders, while only counting people active in the selected period. New means exactly one qualifying order; repeat means more than one. There is no month-gap or cohort-boundary rule.
- Canonicalize customer identity conservatively: exact normalized email is primary; when absent, require normalized phone plus a compatible normalized name. Do not merge records using phone alone, name alone, or loose fuzzy matching. Do not include unsafe identities in customer counts.
- Calculate restock demand independently of the selected reporting period: trailing 90 Europe/London calendar days of positive, mapped, net physical-variant demand across all channels.
- Use the following forecast rules: daily demand is trailing-90-day net units divided by 90; forecast stockout is current counted stock divided by daily demand from the current day; reorder-by is forecast stockout minus stored supplier lead time minus a seven-calendar-day safety buffer.
- Group Restock planning visually beneath a parent physical product only for readability. The calculation, eligibility, date, and urgency are physical-variant specific, and the affected variant must remain explicit.
- Make a physical variant forecast-eligible only with current counted stock, stored supplier lead time, at least 30 days since first paid sale, positive trailing-90-day net demand, and a defensible sales-to-variant mapping. Omit every other variant; do not create a “needs data” list or an invented forecast.
- Display only forecast-eligible variants with a reorder-by date already passed or inside the next 30 days, ordered by urgency.
- Do not recommend order quantities in V1. That later capability requires reliable minimum order quantity, pack-size, target-cover, and purchasing-cadence inputs.
- Use server-side Vercel/Turso reads only. Do not add a data warehouse, separate backend process, third-party analytics SDK, or client-side behavior tracking.
- Cache the aggregate read conservatively and invalidate it after a successful relevant source import or changes to orders, refunds, counted physical stock, mappings, or supplier lead time. The page exposes the last completed-sync timestamp.
- Keep all existing physical inventory, channel listing, packaging, and Lab ingredient boundaries intact. No KPI calculation may make a stock mutation or write channel quantities.
- No new role model is introduced: all currently authenticated app staff may view KPIs.
- The implementation must respect the current project decision on canonical physical-product/physical-variant vocabulary before public interfaces or UI labels are finalized.

## Testing Decisions

- The primary test seam is the complete server-side KPI aggregate/forecast interface. It is approved by the user and should be tested as a public contract, rather than asserting page markup, SQL fragments, cache implementation, or private helper calls.
- Use a disposable local libSQL fixture with operationally representative orders, line items, refund events, mappings, physical counts, and lead times. Tests must never read production data or credentials.
- Follow the existing schema test's temporary local database approach as prior art, but add behavioral tests through the KPI interface rather than extending a schema-only assertion.
- Tests must prove externally visible reporting behavior: Europe/London inclusive boundaries; equal-length comparison periods; VAT/tax/delivery exclusion; cancellation exclusion; full and partial refund timing; zero-safe AOV; product/channel rollups; unassigned lines; customer identity/classification; and top-customer ordering.
- Tests must prove Restock planning behavior: all eligibility gates, refund-adjusted net demand, 90-day fixed demand window independent of the selected report range, stockout/reorder-by math, seven-day safety buffer, urgency ordering, and 30-day action-window omission.
- Add integration coverage that verifies KPI freshness/cache invalidation occurs after a successful source import and every relevant data edit. Tests should observe refreshed results, not a framework-specific invalidation call.
- New tests must be part of the blocking package test command. The current test-discovery issue is therefore a prerequisite.
- Run typecheck, the complete test command, lint, and build before delivery. The repository currently has no formatter or CI gate, so do not claim formatter/CI validation.

## Out of Scope

V1 excludes contextual KPIs on product, order, and customer detail views; customer detail
screens; AI/chatbot analysis; CSV or other exports; VAT/tax and delivery reconciliation;
reorder quantities; email, push, or in-app alerts; role-based KPI authorization; a data
warehouse; a dedicated analytics backend; client-side behavioral tracking; and channel
inventory write-back.

The page is not a stock snapshot, a generic dashboard-card wall, or a financial ledger.
It does not change physical quantities, infer mappings, reconcile historical inventory,
or expose a forecast for incomplete data.

## Further Notes

This work is HITL because it reports historical money and refund data and may require
schema/migration or provider-import review to support all source-supported fields. Any
migration, historical backfill, or production-Turso execution needs explicit human
review under the project's deployment safeguards.

The visual treatment must follow the warm paper, plum/magenta, editorial-but-operational
design system. Favor dense, calm comparison and action surfaces over decorative charts.
The KPI design record remains the source of agreed product behavior; this issue is the
implementation specification derived from it.
