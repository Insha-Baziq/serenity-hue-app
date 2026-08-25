# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Serenity Hue's owner and authenticated operations staff use this private workspace to manage Shopify and TikTok Shop activity, inspect stock, prepare packaging, reconcile deliveries, and maintain staff access. Their primary job is operational control: finding the right order or physical variant quickly and making a safe, traceable update when a count or mapping changes.

## Product Purpose

Serenity Hue Operations gives the team one reliable place to see orders from Shopify and authorized TikTok Shop connections, inspect live channel inventory, count physical inventory and packaging separately, review Parcel2Go delivery data, manage staff accounts, and export operational data. Success means staff can trust what the app says, understand which system owns each number, and complete routine operations without falling back to the old static dashboard, Dropbox files, or paper notes except where physical counts are still maintained.

## Positioning

This is a private operations workspace, not a customer-facing storefront and not a traditional sales CRM. Its distinctive mechanism is a canonical physical catalogue that maps Shopify and TikTok listings independently to real physical variants, including reviewed one-to-many bundle mappings, while preserving each channel's deliberate display-stock strategy.

## Operating Context

- Shopify is the live inventory source for Shopify products, variants, orders, quantities, customers, order lines, payment state, and fulfilment state.
- TikTok Shop is connected through seller OAuth and signed server-side Open API requests. Its listings may be duplicated, relisted, TikTok-only, or bundles, and many do not provide a usable seller SKU.
- Parcel2Go provides the live delivery feed and tracking milestones; it is not a sales channel.
- Development uses local libSQL/SQLite; production uses Turso/libSQL and Vercel. Manual sync remains available alongside scheduled reconciliation.
- Physical counts are maintained separately from channel-reported quantities and may begin as Not counted until staff record a paper count.

## Capabilities and Constraints

- Staff access uses Better Auth with email/password sign-in; operations routes and mutating APIs are session-guarded.
- Current surfaces are Overview, Orders, Employees, Inventory → Products, and Inventory → Packaging. Mobile navigation and touch-friendly summary views are required.
- Products is organized around physical products and child variants. Channel listings map independently to physical variants; a bundle maps to its components and is not a separate physical stock item unless explicitly confirmed as pre-assembled and separately counted.
- Master, Shopify, and TikTok quantities are distinct. Setting a channel display level does not deduct master stock; deliberate TikTok scarcity must not be “corrected” by forcing channel quantities to match.
- Physical inventory edits and channel-mapping edits are authenticated, validated, atomic, and auditable. Inventory ledger entries are append-only.
- Do not invent quantities, SKUs, product details, mappings, live TikTok claims, or delivery matches. Ambiguous mappings remain Needs review or Not mapped.
- AfterShip is not part of the intended architecture. Dropbox and supplied workbooks are historical/source material, not the new system of record.
- Current open work includes sale-driven master decrements, editable channel-level pushes, repeatable master imports, production migration of the local physical catalogue, and final production authentication verification.

## Brand Commitments

- Preserve the Serenity Hue name, accepted plum/magenta palette, existing Avenir Next body typography, Iowan Old Style display typography, and official logo assets.
- Keep the product calm, clear, and operationally modest. Prefer clean, dense, Shopify-inspired tables over promotional dashboard language or speculative analytics.
- Do not alter the official logo or introduce decorative motion that competes with operational work.

## Evidence on Hand

- `project-context.md` is the current product and implementation handoff.
- `public/serenity-hue-logo.jpg`, `public/serenity-hue-logo-black.png`, and login assets are the supplied brand assets.
- `data/` contains historical inventory/source material; the legacy CRM is outside this repository at `C:\Users\baziq\OneDrive\Documents\Freelance\Shabina Khan\CRM`.
- `docs/live-tiktok-shopify-crosswalk-2026-08-21.md` records the seller-authorized TikTok listing audit used for initial mapping review.
- Client-supplied physical catalogue data comes from `individual items.ods`; physical quantities are not assumed where the source does not provide them.
- Do not fabricate testimonials, customer-facing proof, sales claims, or operational metrics not present in the connected data.

## Product Principles

1. Truthful operational state is more important than visual completeness.
2. Physical stock is canonical; channel listings are independent representations.
3. Ambiguity must be visible and reviewable, never silently guessed.
4. Every consequential inventory change must be attributable and auditable.
5. The interface should reduce routine work without hiding important distinctions.

## Accessibility & Inclusion

The web app must remain usable on phone-sized screens with touch-friendly controls, a fixed mobile navigation, readable summary views, keyboard-accessible dialogs and sheets, visible focus states, and clear loading, success, empty, and error feedback. Meaning must not depend on color alone.
