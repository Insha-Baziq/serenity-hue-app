# 008. Analytics hub and Product Health Report

**Status**: open  
**Type**: HITL  
**Triage**: ready-for-agent  
**Blocks**: none

## Problem statement

The existing `/kpis` destination is useful, but it is currently presented as a
standalone analytics page. The client wants a clearer Analytics area that separates
the existing KPI view from a new reporting workspace. The first report is a real,
client-facing Product Health Report, not a download or restyled copy of the KPI page.

## Approved solution

Add an authenticated `/analytics` landing page. The navigation label becomes
**Analytics**, and the landing page presents two prominent destinations:

- **Reports** — `/analytics/reports`
- **KPIs** — preserves the existing KPI workspace, with `/kpis` remaining a
  backward-compatible deep link unless the implementation can safely add an
  `/analytics/kpis` alias.

The Reports destination initially contains one report family: **Product Health
Report**. It supports both:

- an all-products report covering every active physical product; and
- a single physical-product report with variant-level detail.

The report uses the existing server-side KPI/product/inventory domain reads and never
issues SQL from a page or client component.

## Product Report contract

### Scope and period

- Default period: last 30 Europe/London calendar days.
- Default comparison: immediately preceding 30 calendar days.
- Support the existing 7-day, 30-day, 90-day, All time, and custom-period controls
  where those controls are already supported by the KPI reporting contract.
- Show the reporting period, comparison period, generated timestamp, and data
  freshness/current-as-of metadata.

### Sections

All-products mode should contain:

1. Report header and neutral factual summary
2. Overall product performance
3. Product ranking by net units and net revenue
4. Period-over-period product comparisons
5. Weekly/monthly demand trend
6. Physical stock position
7. Shopify-shown and TikTok-shown quantities
8. Days of cover where counted stock and valid demand data exist
9. Variant and bundle-component detail
10. Refunds, cancellations, unmapped sales, and data notes

Single-product mode should adapt the same structure to one physical product and show
its physical variants, channel listings, bundle contributions, and product-specific
trend/comparison data.

### Metric and integrity rules

- Use net merchandise revenue and refund-aware net units from the existing KPI rules.
- Exclude cancelled orders from sales metrics; apply refunds on their processed date.
- Keep physical stock, Shopify-shown stock, and TikTok-shown stock visibly separate.
- Treat bundles as channel listings and show their physical-variant components rather
  than inventing a countable bundle product.
- Keep uncertain or unmapped sales visible as unassigned/unmapped; never infer a
  mapping for presentation.
- Use physical product and physical variant terminology in new public UI and types.
- Display unavailable values explicitly when stock is uncounted, demand is
  insufficient, or a mapping is not defensible.
- Neutral factual observations are allowed (for example, “net units increased 18%”);
  do not produce recommendations, action queues, purchase advice, or priority labels.
- Include existing stock-coverage calculations where their eligibility rules are met;
  label calculations and limitations plainly.

### Presentation

- Follow `DESIGN.md`: warm paper, plum/magenta structure, Source Serif 4-like
  headings, DM Sans-like labels/values, dense tables, restrained charts, and no
  dashboard-card wall.
- Place the official Serenity Hue logo at the top-left of the report header.
- Use a small number of useful visuals: a demand trend and a product-performance or
  channel comparison visual; preserve exact values in accessible tables/disclosures.
- On mobile, replace wide report tables with readable summary rows/disclosure panels.
- Provide a polished PDF export of the generated report. The PDF is a presentation
  of the report model, not a screenshot or raw KPI export.
- Save generated report runs with their period, selection/filter state, generated
  time, and data-freshness metadata so a report can be revisited.

## Implementation checklist

### Routes and navigation

- [ ] Rename the primary navigation destination from KPIs to Analytics.
- [ ] Add authenticated `/analytics` landing page with Reports and KPIs cards.
- [ ] Add `/analytics/reports` report index with the Product Health Report option.
- [ ] Add all-products and single-physical-product Product Report routes/states.
- [ ] Preserve `/kpis` deep links and existing KPI behavior.
- [ ] Keep all new routes behind the existing page session guard.

### Server/domain layer

- [ ] Define a public report query/view-model contract in `lib/`.
- [ ] Reuse existing KPI aggregation and comparison rules instead of duplicating
  refund, period, channel, or product calculations.
- [ ] Add report-specific reads for physical stock, channel listings, mappings,
  bundle contributions, variant detail, coverage, and data notes where needed.
- [ ] Keep SQL inside repository/domain functions and preserve physical/channel/Lab
  inventory boundaries.
- [ ] Add report-run persistence only if it can be done with the existing schema and
  migration conventions; otherwise keep the first slice as deterministic on-demand
  generation and document the follow-up.

### UI and export

- [ ] Build the Analytics landing cards using existing shared primitives.
- [ ] Build the Product Report header, period/comparison controls, factual summary,
  charts, tables, disclosures, and explicit unavailable/empty/error states.
- [ ] Make all-products and single-product modes visibly distinct without creating
  two contradictory report designs.
- [ ] Add product selection/search and links to relevant physical-product detail,
  order, and channel-listing context where safe.
- [ ] Add accessible exact-value disclosures for every visual summary.
- [ ] Implement PDF export from the report-specific view model with the Serenity Hue
  logo in the top-left header.
- [ ] Verify desktop and phone-sized layouts through the local browser loop.

### Tests and validation

- [ ] Add public-contract tests for period boundaries and previous-period comparison.
- [ ] Test refund-aware revenue/units and cancellation exclusion.
- [ ] Test product-group rollups, physical-variant detail, channel splits, bundles,
  unmapped lines, and unavailable values.
- [ ] Test stock/coverage inclusion and limitation states without mutating inventory.
- [ ] Test all-products and single-product query behavior.
- [ ] Test authenticated route/API boundaries and PDF response behavior if an API
  route is introduced.
- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
- [ ] Perform signed-in browser review for Analytics → Reports → Product Report and
  Analytics → KPIs, including mobile presentation and PDF export.

## Out of scope for this slice

- Ads, Affiliate, Customer, and Orders report families.
- AI-generated narrative, chatbot analysis, forecasts beyond the existing eligible
  stock-coverage calculation, purchase quantities, alerts, or recommendations.
- Channel inventory write-back.
- New analytics tracking, data warehouse, or separate backend.
- Changes to the existing KPI metric definitions.

## HITL review points

- Review any schema migration or report-run persistence design before deployment.
- Review PDF output for money, refunds, stock boundaries, and logo fidelity.
- Do not deploy production changes until the full validation gate passes.
