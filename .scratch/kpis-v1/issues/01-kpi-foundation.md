# 01: KPI foundation — date range, headline trading metrics, and trend

**What to build:** Staff can open KPIs directly below Overview and choose a
Europe/London reporting period. They see trustworthy net merchandise sales, paid orders,
AOV, net units, equal-length prior-period comparisons, a daily sales/order trend, and a
quiet data-current timestamp. The feature reads through one tested server-side KPI view
model and refreshes when the underlying trading data changes.

**Blocked by:** none

**Status:** complete — 2026-08-30
**Type:** HITL

- [x] The KPIs destination is authenticated, appears directly below Overview, and follows the approved desktop/mobile Quiet Control Room concepts.
- [x] Staff can select 7, 30, 90, or an inclusive custom range of up to 365 Europe/London calendar days; presets include today.
- [x] Headline metrics and their previous equal-length comparisons use the agreed net merchandise, paid non-cancelled order, AOV, and net-unit definitions.
- [x] Refunds, including source-supported partial refunds, affect revenue and units on their processed date; VAT/tax and delivery charges are excluded.
- [x] The daily trend can switch between net sales and orders, and its data is derived from the same reporting rules as the headline values.
- [x] The page displays the latest completed-sync freshness context and updates after relevant source imports or edits.
- [x] Public-contract tests cover reporting boundaries, comparisons, money/refund rules, zero-safe AOV, and refreshed visible results using a disposable local data fixture.
