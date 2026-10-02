# CONTEXT.md — Serenity Hue Operations

This is the draft ubiquitous language for the internal operations application. The
existing `project-context.md` remains the product-history source; this file gives agents
the short vocabulary needed to make safe changes.

## Human rulings

The project owner confirmed the catalogue vocabulary on 2026-08-30. The code and
product notes use distinct words for physical catalogue concepts and external listings.

| Collision | Recommendation | Status |
|---|---|---|
| product / physical product / master product / physical inventory item | Use **physical product** for a countable catalogue parent; use **physical variant** for its child; reserve **channel listing** for a Shopify/TikTok listing. Keep **master inventory** only for the legacy/three-inventory per-variant quantity model. | Accepted — project owner, 2026-08-30 |
| batch remainder / unpackaged stock | Use **remaining bulk** for the measured formulation left after packaged output. It stays in Labs and is not finished-product stock. | Accepted — product change, 2026-09-18 |
| Labs packaging | Use **formula packaging** for the per-unit fill quantity in its measured unit; it is independent of physical catalogue links and master on-hand. | Accepted — product change, 2026-09-30 |

Align new work to this ruling and avoid reintroducing its rejected alternatives.

## Domain terms

### Batch
A production run made from one formula at a target gram calculation weight. A batch
also records the measured bulk output and its allocation between packaged output and
remaining bulk. Ingredient availability is advisory: known, sufficient ingredients are
deducted; uncounted or insufficient ingredients retain their current count and are
recorded as not deducted.
- **Is not**: an order or an inventory recount
- **Lives in**: `lab_batches`, `lab_batch_ingredients`, `lab_batch_allocations`, and the Lab ledgers

### Formula packaging
The optional amount of formulation assigned to one packaged unit, kept in its measured
unit (grams or milliliters). When set, batch packaging uses this measurement for
finished unit counts. Without it, staff may still record packaged bulk, while finished
unit counts remain unknown. It does not identify or update a master physical product or
its on-hand.
- **Is not**: a master-inventory link, finished-stock adjustment, channel listing,
  packaging material, or ingredient line
- **Lives in**: `lab_formula_packaging` and the Labs packaging ledger

### Remaining bulk
The measured formulation still available to package: batch output minus packaged
output. It is a Labs production allocation, not a countable finished product and not an
ingredient quantity.
- **Is not**: finished-product stock or packaging material
- **Lives in**: `lab_batch_allocations`

### Bundle
A channel sale/listing composed of one or more physical variants with a per-sale
multiplier. A bundle is not itself a countable stock item unless explicitly confirmed.
- **Is not**: a physical product
- **Lives in**: channel listing/component mappings and the inventory application rules

### Channel
One direct sales platform currently supported by the app: `shopify` or `tiktok`.
- **Is not**: the physical stock pool
- **Lives in**: channel integrations, listings, and channel inventory snapshots

### Channel listing
An externally published Shopify or TikTok product/variant listing, including a bundle,
that may be mapped to one or more physical variants.
- **Is not**: a physical catalogue row
- **Lives in**: `physical_channel_listings` and `physical_listing_components`

### Formula
The ingredient definition used to calculate a production batch. Fixed percentages and
remainder water are calculable; plain q.s. ingredients remain intentionally uncomputed.
Formula packaging stores a per-unit fill amount in the measured unit without linking to
the master physical catalogue.
- **Is not**: a batch
- **Lives in**: `lab_formulas`, `lab_formula_ingredients`, and `lab_formula_packaging`

### Ingredient
A Lab production material whose quantity is stored in grams and whose inventory is
separate from finished products and packaging.
- **Is not**: a packaging material or finished-product variant
- **Lives in**: `lab_ingredients` and its immutable ledger

### KPI reporting
The central staff view of business performance over a selected Europe/London reporting
period. It reports net merchandise sales, paid orders, AOV, net units, products,
channels, customers, and a narrowly eligible restock plan from operational data.
- **Is not**: an external analytics product, a finance/VAT report, or the live
  operational Overview
- **Lives in**: the KPIs workspace and repository-level aggregate/forecast reads

### TikTok Shop affiliate KPI reporting
The KPI workspace view of TikTok Shop affiliate-attributed performance over the shared
reporting period. It distinguishes affiliate-attributed sales from estimated affiliate
commission, and reports affiliate orders, units, videos, product performance, and
ranked affiliate performance using TikTok Shop's affiliate and analytics records.
- **Is not**: inferred attribution from ordinary TikTok Shop orders, TikTok Ads
  reporting, or an affiliate-offer management workflow
- **Lives in**: the KPIs workspace and TikTok Shop affiliate/analytics reporting reads

### TikTok Ads connection
The read-only TikTok Marketing API authorization for the configured advertiser account.
Its access and refresh tokens, OAuth state, and authorized advertiser IDs are separate
from TikTok Shop credentials and order/affiliate data.
- **Is not**: a campaign-management integration, TikTok Shop attribution, or evidence
  that every TikTok Shop order came from an ad
- **Lives in**: `tiktok_ads_oauth_states`, `tiktok_ads_connections`, and the KPIs Ads tab

### Inventory ledger
An append-only audit record of a quantity change, actor, reason/type, and reference.
- **Is not**: a current quantity snapshot
- **Lives in**: inventory and Lab ledger tables

### Order
A customer purchase imported from Shopify or TikTok, with line items and independent
payment, fulfillment, cancellation, and shipment information.
- **Is not**: a shipment or a sync run
- **Lives in**: `orders`, `order_items`, and related after-sales tables

### Packaging material
A consumable packing item tracked separately from finished-product and Lab inventory.
- **Is not**: an ingredient or a product variant
- **Lives in**: `packaging_materials` and stock movements

### Shipment
A delivery-provider record associated with an order, including tracking and shipment
events. Parcel2Go is the current provider edge.
- **Is not**: the order itself
- **Lives in**: `shipments` and `shipment_events`

### Sync run
One manual, scheduled, or webhook-triggered reconciliation attempt with a provider,
status, counts, and message, protected by a short database lease.
- **Is not**: a webhook event or a channel snapshot
- **Lives in**: `sync_runs` and `sync_leases`

### Application activity event
A short-lived, human-readable record of one meaningful application operation or one
provider sync outcome. It identifies the actor, source, affected domain, result, and
safe structured details for the staff activity feed.
- **Is not**: a SQL log, a provider payload archive, a session touch, or a replacement
  for a permanent inventory, ingredient, batch, shipment, or reconciliation ledger
- **Lives in**: `application_activity_log` and the protected `/logs` workspace

### Restock plan
An action queue for mapped physical variants that have counted stock, a stored supplier
lead time, at least 30 days since their first paid sale, and positive trailing-90-day
net demand. It predicts stockout and reorder-by dates but does not invent missing data
or recommend a purchase quantity in V1.
- **Is not**: a static low-stock list, a channel inventory snapshot, or a stock count
- **Lives in**: KPI forecast reads over physical inventory, order history, and mappings

### VAT invoice
A purchase invoice or receipt the business received, kept for the UK VAT return
with its supplier, invoice date (tax point), net/VAT/total in exact minor units, and
its filed document. A **saved** VAT invoice has its document filed in the shared
Dropbox by invoice month. VAT invoices are business-wide records, not owned by a
staff member.
- **Is not**: a customer order, a sales/KPI figure, or a channel payout
- **Lives in**: `vat_invoices`, the `/vat` workspace, and `/Invoices/<year>/<MM - Month>/` in Dropbox

### To get item
A purchase the business made whose invoice was not in the email (bill on the
supplier's website, no invoice in the email, or an unpaid payment request). Staff
fetch the invoice and upload it. It is never silently dropped.
- **Is not**: a saved invoice or an ignored email
- **Lives in**: `vat_invoices` with status `to_get` and a reason note

### Removed VAT record
A VAT invoice or To get item taken out of the working lists, with a reason and the
staff member who removed it. It is retained, can be restored, and its document
moves to `/Invoices/_Removed/` rather than being deleted.
- **Is not**: a deletion
- **Lives in**: `vat_invoices` with status `removed`

### VAT connection
The single business Dropbox used for filing, or a business inbox authorization.
Connected once by any staff member and shared by all. Tokens are encrypted and
server-only. Connecting an inbox does not read mail; inbox sync is deferred.
- **Is not**: a personal staff integration or a TikTok/Shopify credential
- **Lives in**: `vat_connections` and `vat_mail_accounts`

## Deliberately rejected words

| Don't say | Say | Why |
|---|---|---|
| master product or physical inventory item for the countable catalogue parent | physical product | Separates the physical catalogue parent from its legacy quantity model. |
| product item for a countable catalogue child | physical variant | Keeps the child distinct from its parent and a channel listing. |
| inventory item for a Shopify/TikTok listing | channel listing | Keeps external listing identity distinct from countable stock. |
| recipe when referring to an authored Lab definition | formula | Matches the UI and schema. |
| delivery when referring to a provider record | shipment | Delivery is the customer-facing outcome; the provider object is a shipment. |


## Actors

| Actor | Who they are | What they can do |
|---|---|---|
| Staff member | An authenticated Serenity Hue operator | View operations, edit inventory/Lab quantities, create employees, and trigger guarded sync/mapping actions. |
| Channel provider | Shopify or TikTok | Supplies orders/listings/quantities and receives webhook traffic; write-back is not generally enabled. |
| Delivery provider | Parcel2Go | Supplies shipment records and events through its webhook/API edge. |
| Sync scheduler | QStash calling the reconcile route | Triggers a guarded reconciliation run. |

## Invariants

1. Physical inventory is separate from channel snapshots and Lab ingredient inventory.
2. Inventory and ingredient quantity changes are audit-recorded and attributable.
3. A physical variant cannot be deleted while an exact mapping depends on it; deletion is soft where history must remain.
4. A channel bundle maps to its exact physical components and multipliers; uncertain mappings stay review/unmapped.
5. A sync run cannot overlap another direct-channel run because the lease is database-backed.
6. Secrets and provider tokens are read only in server-side code and are never sent to the client.
7. Batch creation never requires a counted ingredient and never creates a negative ingredient quantity.
8. A batch's packaged output cannot exceed its batch size; when a formula fill size is configured, each packaging increment must match its unit and produce a whole number of finished units.
9. VAT records and their Dropbox documents are never permanently deleted; removal is retained and reversible, and VAT money is stored as exact integer minor units.
10. VAT data is business-wide: any signed-in staff member sees and acts on the same records and connections; staff identity is recorded only for audit.
