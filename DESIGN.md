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
    fontFamily: "Iowan Old Style, Baskerville, Times New Roman, serif"
    fontSize: "clamp(2.5rem, 4.8vw, 4rem)"
    fontWeight: 400
    lineHeight: 0.96
    letterSpacing: "-0.065em"
  body:
    fontFamily: "Avenir Next, Segoe UI Variable, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Avenir Next, Segoe UI Variable, Segoe UI, sans-serif"
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

The visual language is editorial at the edges and utilitarian at the center: Iowan Old Style gives major titles a human, considered voice; Avenir Next keeps labels, numbers, filters, and tables quick to scan. Motion is brief and tactile, used to confirm interaction or reveal state rather than decorate the page.

**Key Characteristics:**

- Warm paper canvas with plum/magenta anchors.
- Dense, Shopify-inspired tables and progressive disclosure through sheets and detail pages.
- Clear separation between physical, Shopify, and TikTok quantities.
- Soft borders and tinted shadows instead of heavy chrome.
- Mobile-first operational access through touch-friendly summaries and bottom navigation.

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

**Display Font:** Iowan Old Style, Baskerville, Times New Roman, serif

**Body Font:** Avenir Next, Segoe UI Variable, Segoe UI, sans-serif

**Character:** The pairing balances Serenity Hue's editorial identity with the speed and clarity expected from an operations tool. Display type is used selectively; table content, controls, and numbers stay in the practical sans-serif voice.

### Hierarchy

- **Display** (400, `clamp(2.5rem, 4.8vw, 4rem)`, `0.96`): Workspace and login headings.
- **Headline** (400–500, approximately `25–38px`): Detail-sheet and product titles.
- **Title** (650–760, approximately `16–22px`): Panel titles and table section headings.
- **Body** (400, `14px`, `1.5–1.6`): Descriptions and operational guidance.
- **Label** (650–800, `10–12px`, slight tracking): Table headers, filters, chips, and status labels.

**The Two-Voice Type Rule.** Use serif for considered identity and clear page-level hierarchy; use Avenir Next for every action, value, label, and decision.

## Layout

Desktop uses a persistent application shell with a sidebar and a flexible main workspace. The expanded sidebar is approximately `234px`; the collapsed rail is approximately `72px`. The main content is constrained by generous horizontal padding and uses dense, full-width operational tables rather than dashboard-card mosaics.

Page headers are left-aligned with a small kicker, a clear title, and a short description. Toolbars keep search and filters grouped near the data they control. Details open in sheets or dedicated detail pages so tables stay scannable.

At smaller widths, the shell becomes a compact top navigation or bottom-navigation experience. Tables are replaced by touch-friendly summaries where horizontal scrolling would harm the task. Controls remain available, but column customization belongs to larger screens.

## Elevation & Depth

Depth is quiet and structural. Borders and tonal paper changes do most of the grouping work; shadows are diffuse and tinted toward plum rather than gray or black. Sheets, popovers, and dialogs may use stronger elevation because they are temporary layers. Avoid persistent ornamental shadows on every component.

### Shadow Vocabulary

- **Soft panel:** `0 18px 50px rgba(74, 33, 57, 0.08)` for light grouping and floating controls.
- **Floating layer:** `0 22px 70px rgba(67, 24, 55, 0.17)` for select menus, popovers, and sheets.
- **Micro lift:** a small tinted shadow or `translateY(-1px)` for tactile hover feedback.

**The Paper-First Rule.** A surface should read as paper, line, or spacing before it reads as a shadow.

## Shapes

The form language uses restrained rounded rectangles: approximately `5px` for compact chips, `8px` for table controls and status treatments, `11px` for buttons and fields, and `15px` for large table frames or primary panels. Pills are reserved for statuses and compact state indicators, not general-purpose containers.

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

- **Corner style:** `12–15px` for primary panels; `5–9px` for dense sub-containers.
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
- **Mobile:** Compact navigation with direct access to Overview, Orders, Employees, Products, and Packaging; important actions remain reachable by touch.
- **Active state:** Magenta edge/indicator plus a tinted surface, not color alone.

### Tables

Tables are the primary operational surface. Use readable headings, compact but touch-safe rows, visible status labels, configurable columns where useful, pagination, search/filter controls, and a clear empty state. On mobile, replace wide tables with task-focused summary cards when possible.

## Do's and Don'ts

### Do:

- **Do** preserve the Avenir Next and Iowan Old Style pairing.
- **Do** use physical, Shopify, and TikTok labels exactly where quantities could otherwise be confused.
- **Do** use real data, reviewed mappings, and explicit Not counted / Needs review states.
- **Do** keep tables dense but breathable, with clear row hover/focus feedback.
- **Do** include loading, empty, error, success, and reduced-motion-safe states.
- **Do** use the official Serenity Hue logo assets without modification.

### Don't:

- **Don't** introduce generic SaaS purple/blue gradients, neon glows, or decorative analytics.
- **Don't** replace operational tables with a wall of summary cards.
- **Don't** invent product quantities, SKUs, mapping relationships, or delivery matches.
- **Don't** force Shopify and TikTok quantities to match; their display strategies are intentionally independent.
- **Don't** use continuous decorative animation or hide important state behind hover alone.
- **Don't** crop, letterbox, or blend product imagery against the confirmed detail-page behavior.
