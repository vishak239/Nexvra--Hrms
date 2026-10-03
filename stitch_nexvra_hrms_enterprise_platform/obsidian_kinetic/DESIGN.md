---
name: Obsidian Kinetic
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#bfcbae'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#8a957a'
  outline-variant: '#404a34'
  surface-tint: '#86dd00'
  primary: '#ffffff'
  on-primary: '#1e3700'
  primary-container: '#9afc00'
  on-primary-container: '#427000'
  inverse-primary: '#3e6a00'
  secondary: '#c8c6c9'
  on-secondary: '#303033'
  secondary-container: '#47464a'
  on-secondary-container: '#b6b4b8'
  tertiary: '#ffffff'
  on-tertiary: '#303033'
  tertiary-container: '#e4e1e6'
  on-tertiary-container: '#656467'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#9afc00'
  primary-fixed-dim: '#86dd00'
  on-primary-fixed: '#0f2000'
  on-primary-fixed-variant: '#2d5000'
  secondary-fixed: '#e4e1e5'
  secondary-fixed-dim: '#c8c6c9'
  on-secondary-fixed: '#1b1b1e'
  on-secondary-fixed-variant: '#47464a'
  tertiary-fixed: '#e4e1e6'
  tertiary-fixed-dim: '#c8c5ca'
  on-tertiary-fixed: '#1b1b1e'
  on-tertiary-fixed-variant: '#47464a'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-lg:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.03em
  display-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-xl:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Space Grotesk
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.04em
  data-metric:
    fontFamily: Space Grotesk
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.03em
  code-mono:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-lg: 1.5rem
  margin: 1rem
  margin-md: 1.5rem
  margin-lg: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system embodies high-performance enterprise utility, built for precision, speed, and cognitive clarity in complex workforce administration. Rooted in technical minimalism and high-contrast ergonomics, the visual identity rejects skeuomorphic gloss, heavy gradients, and superficial glassmorphism in favor of structured architectural boundaries and razor-sharp typographic hierarchy.

The aesthetic evokes the discipline of professional developer environments and financial terminals, adapted for modern human capital management. The interface instills a sense of absolute control, organizational intelligence, and administrative authority. Deep black surfaces anchor the workspace, reducing fatigue across long operational cycles, while surgical electric lime accents guide attention instantaneously to primary workflows, system alerts, and critical HR metrics.

## Colors

The palette operates on high-contrast binary foundations with a singular high-energy activator:

- **Canvas & Backgrounds:** The base substrate relies on true pure black (`#000000`) for structural sidebars and primary application frames, transitioning to `#050505` and `#0A0A0C` for container elevations and nested workspaces.
- **Accents:** Electric Lime (`#9CFF00`) functions strictly as an operational beacon. It is reserved for primary actions, active navigational indicators, affirmative validation, and standout data metrics. On electric lime surfaces, all typography and iconography must be forced to deep pitch black (`#000000`) with medium or semibold weights to preserve strict WCAG AAA legibility.
- **Structural Lines:** Structural division avoids heavy dropped shadows, relying entirely on crisp 1px borders rendered in `#18181B` (subtle partition) and `#27272A` (interactive surfaces, card perimeter, and cell dividers).
- **Typography & Content:** Headlines, key values, and critical labels use absolute white (`#FFFFFF`). Secondary context, table metadata, and inactive labels use muted neutral slate (`#A0A0A0`). Disabled states and placeholder hints fall to `#52525B`.
- **Functional Semantics:** Red (`#FF453A`) for critical compliance warnings and termination flows; Amber (`#FFD60A`) for pending approvals; Emerald (`#30D158`) for operational uptime and payroll completion.

## Typography

The typographic hierarchy balances technical character with supreme density and read efficiency. 

Headings employ **Space Grotesk** to inject a disciplined, modern enterprise feel. With tight negative tracking (`-0.01em` to `-0.03em`) and structured geometric proportions, titles act as definitive anchors across dashboards and section layouts.

Body text, form inputs, metrics, and dense tabular data are set in **Inter**. Its neutral grotesque structure, clear counters, and tall x-height maximize sustained scanning clarity in wide employee registries, payroll calculations, and compliance audit logs. Tabular numbers (`tnum`) must be enforced globally for all monetary calculations, timestamps, headcount tallies, and serial codes.

## Layout & Spacing

This design system uses a technical 12-column fluid grid system paired with strict 4px/8px modular base rhythm for element composition. 

- **Layout Structure:** Screen viewports are bounded by persistent horizontal header bars (56px fixed height) and collapsable structural side navigation rails (240px expanded / 64px collapsed). Inner workspaces utilize fluid multi-column containers designed to expand cleanly up to an ultra-wide safe constraint of 1600px.
- **Breakpoints:**
  - **Mobile (< 768px):** 4 columns, single-column stacked data widgets, drawer navigation, 16px margins, compact rows.
  - **Tablet (768px - 1024px):** 8 columns, 2-column metric cards, responsive table horizontal scrolling, 24px margins.
  - **Desktop (1024px+):** 12 columns, fixed sidebar, simultaneous split-pane master-detail drawers, 32px canvas margins.
- **Information Density:** Spacing favors compact efficiency over decorative whitespace. Component padding adheres tightly to `space-sm` (8px) and `space-md` (12px) to maximize on-screen records per view without sacrificing interactive hit targets (minimum 36px interactive bounds for desktop utility, 44px on mobile touch viewports).

## Elevation & Depth

Spatial layering in this design system rejects blurry dropshadows, blurred backdrops, and artificial skeuomorphic lighting. Visual depth is established through a strict **low-contrast outline and tonal layering framework**:

- **Ground (Level 0):** Pure absolute black (`#000000`). Used for the main body canvas and global structural sidebars.
- **Surface (Level 1):** `#050505` to `#09090B`. Applied to primary cards, workspace canvases, table wrappers, and operational panels. Delineated by a uniform 1px solid border in `#18181B`.
- **Elevated (Level 2):** `#121214`. Used for dropdown menus, popovers, contextual tooltips, action modals, and flyout sliding sheets. Bounded by a crisp 1px border in `#27272A`.
- **Focus & Selection:** Active cards, table row selections, or modal boundaries leverage an elevated 1px perimeter border rendered in `#27272A` or illuminated with a targeted, precise 1px `#9CFF00` accent stroke. No ambient box-shadow glow is permitted unless explicitly required for emergency system modal barriers.

## Shapes

The geometric vocabulary prioritizes surgical precision. Forms adhere to a controlled `roundedness: 1` tier:
- Standard interactive elements (input fields, operational buttons, dropdown toggles, inline badges, and table cards) utilize a sharp **4px** corner radius (`rounded-sm`).
- Outer dialog surfaces, major dashboard container sections, and modal viewports use an **8px** maximum corner radius (`rounded-lg`).
- Pill shapes are strictly prohibited except for small numerical notification count chips (max 16px height) and discrete status dot containers. Sharp architectural cuts reflect the institutional, high-precision identity of the software.

## Components

### Buttons
- **Primary:** Background in `#9CFF00`, text and icons in `#000000` (Inter Medium 13px), radius 4px. Hover transitions to `#86E000`. Active state deepens to `#72C200`. Zero shadow.
- **Secondary:** Surface `#09090B`, 1px solid border `#27272A`, text `#FFFFFF`. Hover updates border to `#52525B` and background to `#121215`.
- **Ghost / Tertiary:** Transparent background, text `#A0A0A0`, hover text `#FFFFFF` with background `#18181B`.
- **Destructive:** Background `#180808`, 1px solid border `#4A1010`, text `#FF6B6B`. Hover border `#7A1A1A`.

### Input Fields & Controls
- **Inputs:** Dark field `#050505` with a 1px border `#27272A`. Text `#FFFFFF`, placeholder `#52525B`. Height 36px for high density.
- **Focus State:** 1px border `#9CFF00` with an offset-free 1px outline in `#9CFF00`.
- **Checkboxes & Radios:** 16x16px frame with 1px border `#27272A`, radius 2px (checkbox) or circular (radio). When checked, filled with `#9CFF00` containing a `#000000` check mark.

### Data Tables & Lists
- **Structure:** Encased in a Level 1 `#050505` container with a 1px outer `#18181B` border.
- **Headers:** Background `#000000`, 32px height, uppercase 11px Inter Medium label in `#A0A0A0`, bottom border 1px solid `#18181B`.
- **Rows:** Alternating subtle background or flat `#050505`, border-bottom 1px solid `#121214`. Row height 44px standard, hover state `#0E0E11`.
- **Row Selected:** Background `#0F1707` with a 2px left border accent in `#9CFF00`.

### Status Badges & Chips
- **Chips:** Height 22px, padding 2px 8px, 4px radius.
- **Active / Success:** `#0C1805` surface, 1px border `#1F380A`, text `#9CFF00`.
- **Warning:** `#1F1600` surface, 1px border `#473400`, text `#FFD60A`.
- **Critical / Inactive:** `#1C0808` surface, 1px border `#3D1212`, text `#FF453A`.

### Cards & Panels
- **Structure:** `#070709` surface, 1px solid border `#18181B`, 4px radius, 16px internal padding.
- **KPI Metric Card:** Contains a muted 12px uppercase label (`#A0A0A0`), prominent numerical metric in Space Grotesk 28px (`#FFFFFF`), with a secondary contextual trend badge (`#9CFF00` or `#FF453A`).

### Audit Trail & Timeline Logs
- Continuous vertical 1px line in `#18181B` aligned to the left. Node markers are 8x8px square indicators (active: `#9CFF00`, past: `#27272A`). Log timestamps formatted in 11px tabular Inter text.