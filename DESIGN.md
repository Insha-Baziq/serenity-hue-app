---
name: Serenity Hue Operations
description: A calm, precise control room for orders, stock, channels, and delivery operations.
colors:
  canvas: "#fcfaf8"
  canvas-muted: "#f8f1f5"
  paper: "#fffefd"
  paper-strong: "#ffffff"
  ink: "#33212d"
  ink-soft: "#756a70"
  ink-faint: "#a89da2"
  line: "#e9dfe2"
  line-strong: "#ddcdd3"
  plum: "#6c285f"
  plum-dark: "#49163f"
  magenta: "#c13a9b"
  magenta-soft: "#f8e9f2"
  green: "#437d67"
  green-soft: "#e7f2ec"
  orange: "#d8781b"
  orange-soft: "#fff3e4"
  red: "#c84954"
  red-soft: "#fff0f1"
  rose: "#d88a9e"
typography:
  display:
    fontFamily: "Source Serif 4, Georgia, Times New Roman, serif"
    fontSize: "clamp(2.5rem, 4.8vw, 4rem)"
    fontWeight: 400
    lineHeight: 0.96
    letterSpacing: "-0.045em"
  body:
    fontFamily: "DM Sans, Segoe UI, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  label:
    fontFamily: "DM Sans, Segoe UI, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  xs: "5px"
  sm: "8px"
  md: "11px"
  lg: "15px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.plum-dark}"
    textColor: "{colors.paper-strong}"
    rounded: "{rounded.md}"
    padding: "0 17px"
    height: "42px"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.plum-dark}"
    rounded: "{rounded.md}"
    padding: "0 17px"
    height: "42px"
  input:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "43px"
  table:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 13px"
  status-chip:
    backgroundColor: "{colors.magenta-soft}"
    textColor: "{colors.plum-dark}"
    rounded: "{rounded.sm}"
    padding: "0 9px"

# Design System: Serenity Hue Operations

## Overview

**Creative North Star: "The Quiet Control Room"**

The incumbent system treats operations as a calm, precise workspace rather than a loud analytics product. Warm paper surfaces and soft plum structure give the app a recognizable Serenity Hue presence, while compact tables, clear status treatments, and restrained elevation keep the interface useful during repetitive operational work.

The visual language is editorial at the edges and utilitarian at the center: Source Serif 4 gives major titles a human, considered voice; DM Sans keeps labels, numbers, filters, and tables quick to scan. Motion is brief and tactile, used to confirm interaction or reveal state rather than decorate the page.

**Key Characteristics:**

- Warm paper canvas with plum/magenta anchors.
- Dense, Shopify-inspired tables and progressive disclosure through sheets and detail pages.
- Clear separation between physical, Shopify, and TikTok quantities.
- Soft borders and tinted shadows instead of heavy chrome.
- Mobile-first operational access through touch-friendly summaries and a compact top bar with a single navigation menu.

## Colors

The palette is warm, muted, and brand-specific: plum carries structure, magenta marks active state, and green/orange/red communicate operational status. Accent color should remain rare enough to preserve meaning.

### Primary

- **Serenity Plum** (`#6c285f`): Primary navigation, links, and calm action emphasis.
- **Deep Plum** (`#49163f`): High-contrast primary actions and active text.
- **Serenity Magenta** (`#c13a9b`): Selected states, active indicators, and the most important live emphasis.

### Secondary

- **Rose** (`#d88a9e`): Soft supporting accent for details and gentle emphasis.

### Neutral

- **Warm Canvas** (`#fcfaf8`): Default application background.
- **Muted Canvas** (`#f8f1f5`): Secondary surface and subtle grouping background.
- **Paper** (`#fffefd`): Tables, panels, fields, and sheets.
- **Ink** (`#33212d`): Primary text.
- **Soft Ink** (`#756a70`): Descriptions and supporting metadata.
- **Faint Ink** (`#a89da2`): Low-priority metadata and disabled-adjacent text.
- **Line** (`#e9dfe2`): Default dividers and borders.
- **Strong Line** (`#ddcdd3`): Field and control boundaries.

### Status

- **Stock Green** (`#437d67`) with **Green Wash** (`#e7f2ec`): Healthy or available state.
- **Attention Orange** (`#d8781b`) with **Orange Wash** (`#fff3e4`): Low-stock or review-needed attention.
- **Error Red** (`#c84954`) with **Red Wash** (`#fff0f1`): Errors and unsafe states.

**The One-Meaning Accent Rule.** Magenta marks active interface state; it must not become a generic decoration or a second status system.

## Typography

**Display Font:** Source Serif 4, Georgia, Times New Roman, serif

**Body Font:** DM Sans, Segoe UI, Arial, sans-serif

**Character:** The pairing balances Serenity Hue's editorial identity with the speed and clarity expected from an operations tool. Display type is used selectively; table content, controls, and numbers stay in the practical sans-serif voice.

### Hierarchy

- **Display** (400, `clamp(2.5rem, 4.8vw, 4rem)`, `0.96`): Workspace and login headings.
- **Headline** (400–500, approximately `25–38px`): Detail-sheet and product titles.
- **Title** (650–760, approximately `16–22px`): Panel titles and table section headings.
- **Body** (400, `14px`, `1.5–1.6`): Descriptions and operational guidance.
- **Label** (650–800, `10–12px`, slight tracking): Table headers, filters, chips, and status labels.

**The Two-Voice Type Rule.** Use Source Serif 4 for considered identity and clear page-level hierarchy; use DM Sans for every action, value, label, and decision.

## Layout

Desktop uses a persistent application shell with a sidebar and a flexible main workspace. The expanded sidebar is approximately `234px`; the collapsed rail is approximately `72px`. The main content is constrained by generous horizontal padding and uses dense, full-width operational tables rather than dashboard-card mosaics.

Page headers are left-aligned and led by a clear title. Add a short description only when it prevents a real domain mistake; do not use decorative kickers or narrate what the page title and controls already communicate. Toolbars keep search and filters grouped near the data they control. Details open in sheets or dedicated detail pages so tables stay scannable.

At smaller widths, the shell becomes a compact top navigation or bottom-navigation experience. Tables are replaced by touch-friendly summaries where horizontal scrolling would harm the task. Controls remain available, but column customization belongs to larger screens.

## Elevation & Depth

Depth is quiet and structural. Borders and tonal paper changes do most of the grouping work; shadows are diffuse and tinted toward plum rather than gray or black. Sheets, popovers, and dialogs may use stronger elevation because they are temporary layers. Avoid persistent ornamental shadows on every component.

### Shadow Vocabulary

- **Soft panel:** `0 18px 50px rgba(74, 33, 57, 0.08)` for light grouping and floating controls.
- **Floating layer:** `0 22px 70px rgba(67, 24, 55, 0.17)` for select menus, popovers, and sheets.
- **Micro lift:** a small tinted shadow or `translateY(-1px)` for tactile hover feedback.

**The Paper-First Rule.** A surface should read as paper, line, or spacing before it reads as a shadow.

## Shapes

The form language uses restrained rounded rectangles: approximately `5px` for compact chips, `8px` for table controls and status treatments, `11px` for buttons and fields, and `16px` for large table frames or primary panels. Pills are reserved for statuses and compact state indicators, not general-purpose containers.

Borders are soft and low-contrast. Active controls may use a thin magenta or plum edge, but the system avoids thick outlines and excessive nested containers.

## Components

### Buttons

- **Shape:** Soft rounded rectangle (`11px`), minimum height `42px` for primary actions.
- **Primary:** Deep plum/plum-magenta treatment with white text; use for the single most important action in a group.
- **Outline:** Paper background with strong plum-tinted border; use for secondary actions.
- **Ghost:** Transparent with plum text; use for low-risk contextual actions.
- **States:** Hover lifts very slightly; active presses down with a small scale reduction; focus uses a visible magenta ring; disabled controls reduce opacity without changing meaning.

### Chips

- **Style:** Compact rounded labels with muted status fills or thin borders.
- **State:** Text and shape must communicate the state in addition to color. Mapping states use Confirmed, Needs review, or Not mapped rather than color-only dots.

### Cards / Containers

- **Corner style:** `14–16px` for primary panels; `5–9px` for dense sub-containers.
- **Background:** Paper over warm canvas.
- **Shadow strategy:** Flat by default; tinted shadow only for elevation or floating context.
- **Border:** One soft divider; avoid stacked cards inside cards.
- **Internal padding:** Usually `16–24px`, reduced for dense table headers and mobile.

### Inputs / Fields

- **Style:** Paper or translucent paper fill, `1px` strong line, `10–11px` radius, approximately `43px` control height.
- **Focus:** Clear magenta/plum outline or ring with no reliance on color alone.
- **Error / disabled:** Keep the field structure stable; show plain-language error text near the field and preserve entered work.

### Navigation

- **Desktop:** Plum-toned sidebar with labeled grouped navigation, active indicator, nested Inventory links, and a persistent collapse rail.
- **Mobile:** A slim fixed top bar shows the Serenity Hue Operations lockup and one 44px menu control. The menu reveals every destination in a single clear list; do not cram destinations into a bottom dock. Important actions remain reachable by touch.
- **Active state:** Magenta edge/indicator plus a tinted surface, not color alone.

### Tables

Tables are the primary operational surface. The Products table is the visual source of truth: use its quiet blush header (`#fcf7f9`), plum header text, `46px` header rhythm, compact rows, restrained pink hover, `16px` outer corners, and clear dividers everywhere. Use the shared pagination helper so page numbers are always ascending with the current page visible; never create a route-specific pagination sequence. Keep status labels only when they communicate actionable operational state, plus configurable columns where useful, search/filter controls, and a clear empty state. On mobile, replace wide tables with task-focused summary cards when possible.

### Labs

Labs is a focused production workflow, not an analytics dashboard. Its home uses a compact, text-led formula-card grid without invented product imagery: title and source-derived subtitle lead, while ingredient count and the open affordance sit in a quiet footer. The grid expands naturally as formulas are added. **Add formula** opens a protected-focus ratio builder, where named ingredients may be selected or created as `Not counted`; there is at most one remainder-to-100% line, and manual q.s. lines are intentionally excluded from automatic deductions. Formula detail pages lead with the formula name, a small lab mark, the source notes, and a dense ratio table. The **Create batch** action opens a protected-focus dialog: batch reference and target weight in grams first, then a plain-language deduction review before confirmation. Ingredient inventory remains a distinct route, is paginated at 10 ingredients per page, and clearly states that it does not affect finished-product or packaging stock.

## Do's and Don'ts

### Do:

- **Do** preserve the Source Serif 4 and DM Sans pairing.
- **Do** use physical, Shopify, and TikTok labels exactly where quantities could otherwise be confused.
- **Do** label Labs quantities in grams and show `Not counted` rather than an invented zero.
- **Do** use real data, reviewed mappings, and explicit Not counted / Needs review states.
- **Do** keep tables dense but breathable, with clear row hover/focus feedback.
- **Do** reserve supporting copy for risk, recovery, ambiguity, or a consequential action.
- **Do** include loading, empty, error, success, and reduced-motion-safe states.
- **Do** use the official Serenity Hue logo assets without modification.

### Don't:

- **Don't** introduce generic SaaS purple/blue gradients, neon glows, or decorative analytics.
- **Don't** replace operational tables with a wall of summary cards.
- **Don't** invent product quantities, SKUs, mapping relationships, or delivery matches.
- **Don't** force Shopify and TikTok quantities to match; their display strategies are intentionally independent.
- **Don't** mix ingredient inventory with product or packaging inventory, or auto-deduct an ingredient whose supplied formula ratio is only `q.s.`.
- **Don't** use continuous decorative animation or hide important state behind hover alone.
- **Don't** add reassuring labels such as “healthy,” “live,” or “secure,” repeat a visible role/type under every row, or explain relationships already made obvious by navigation and column labels.
- **Don't** crop, letterbox, or blend product imagery against the confirmed detail-page behavior.

### KPI Performance surface (2026-09-06)

The `/kpis` workspace is a chart-led **Operate** surface within the Quiet Control Room. This scoped composition records the requested KPI overhaul; it supersedes the earlier KPI brief's tables-only/no-pie direction without changing the global brand or other operational surfaces. The implementation reference is `components/kpis-workspace.tsx` and its CSS module; the full surface brief is `.impeccable/surfaces/docs-design-2026-08-30-kpis-v1-md.md`.

- **Hierarchy:** An editorial serif “Performance” header pairs with compact freshness metadata. Business overview and TikTok Shop affiliates share one reporting-period selector (7, 30, 90 days, All time, or custom dates). Four restrained metrics precede the main trend and supporting composition/activity panel, then rankings and detailed records.
- **Material and type:** Preserve warm paper, plum structure, rose support, and practical sans-serif values with tabular numerals. Paper panels use soft borders and approximately 13–14px corners; the leading metric has a light plum wash. Charts use restrained plum fills and lines, readable labels, and subtle horizontal guides. Data-series colors have explicit legends and do not imply operational status.
- **Chart grammar:** Sales trends switch between net sales and orders, with area/bar presentation and an exact-value table in a native disclosure. Channel mix uses paid-order counts so refunded net revenue cannot create negative donut fractions. Product ranks show net units and net revenue; new/repeat customer composition is accompanied by counts and recorded-history definitions.
- **Affiliate grammar:** Revenue, Orders, and Commission switch the creator ranking and detailed-record order. Sales concentration compares the top five with other creators using positive identified-creator net sales only; the exclusion of negative sales and unidentified creators stays visible. Negative ranking results remain explicit values rather than positive-looking bars. Estimated commission stays distinct from business revenue.
- **Responsive behavior:** The desktop report uses four metrics and unequal two-column chart rows. At 950px and below, metrics become two columns and chart rows stack. At 600px and below, the date control follows the tabs, panel spacing tightens, and the wide affiliate table becomes native expandable creator summaries with net sales and orders visible before expansion. Search and show-all controls apply to both presentations.
- **Trust and access:** Preserve visible focus, keyboard tab navigation, labelled measure/style controls, native detail disclosures, honest empty and stale states, and reduced-motion chart behavior. Compact reporting notes carry history and reconciliation caveats. Exact chart, channel, and product values remain available beyond the visual summaries; no chart or comparison may fabricate data.

### Overview daily brief (2026-09-06)

The `/overview` workspace is the operational home screen, not a duplicate reporting dashboard. Its first viewport answers three questions in order: what requires action, what work is currently moving, and which workspace should staff open next. KPI trends and business analysis remain in `/kpis`. The implementation reference is `components/overview-workspace.tsx`; the full surface brief is `.impeccable/surfaces/components-overview-workspace-tsx.md`.

- **Hierarchy:** Use a restrained editorial masthead with sync freshness and one sync action, followed by an asymmetric needs-attention queue and recent-order ledger. A four-part operations pulse for physical inventory, packaging, Shopify orders, and TikTok Shop orders anchors the page below.
- **Content:** Attention rows must come from real operational conditions and link directly to the relevant workspace. Do not turn raw provider fulfilment metadata into a task count; use delivery-aware progress in the recent-order ledger and reserve the queue for proven inventory or packaging actions until an explicit internal fulfilment state exists. Connection status is meaningful; reassuring health badges, section numbers, decorative kickers, and explanatory filler are not.
- **Material:** Primary sections are flat warm-paper surfaces with one soft border, `16px` corners, open row dividers, small tinted icon tiles, serif section titles, and sans-serif operational values. Avoid nested cards and persistent ornamental shadows.
- **Responsive behavior:** Stack the attention queue above the order ledger on smaller screens. Render orders as readable multi-line rows rather than a horizontally scrolling table. The operations pulse becomes a two-column grid while preserving labels, values, state, and destination links.
- **Motion and access:** Use only a brief reduced-motion-safe entrance and subtle row hover. Links and the sync control retain visible focus states, and no important state depends on color or hover alone.
