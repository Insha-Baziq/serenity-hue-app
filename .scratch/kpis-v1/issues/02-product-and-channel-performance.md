# 02: KPI product and channel performance

**What to build:** Staff can identify the leading mapped physical products and compare
Shopify with TikTok from the KPI page. Every value remains honest about source mappings:
unknown sales are visible as unassigned rather than guessed into a product.

**Blocked by:** none

**Status:** complete — 2026-08-30
**Type:** HITL

- [x] The KPI page shows the top ten mapped physical products, ranked by net units sold, with net product revenue and Shopify/TikTok contribution.
- [x] Variant-level sales roll up to the agreed physical-product parent without concealing the physical-variant context needed by later stock planning.
- [x] Unmapped or uncertain source lines are explicitly represented as unassigned and are never inferred into a physical product.
- [x] The Shopify/TikTok comparison presents net merchandise sales, paid orders, AOV, and net-unit share in a compact table rather than a pie chart.
- [x] Product and channel results apply the shared reporting period, refund timing, cancellation, and excluded-charge rules from Ticket 01.
- [x] The visible product/channel results refresh after relevant imports, refund updates, and mapping changes.
- [x] Public-contract tests prove mapped rollups, unassigned behavior, channel splits, and refund-adjusted product values.
