# PASPL Design System Analysis

This document is an extracted reference of the current design system implemented in `src/index.css`. You can use this to review, critique, and propose improvements to your styling architecture.

---

## 1. Core Palette & Color Scale

### Core Brand Constants
- **Primary:** `#2563eb`
- **White:** `#ffffff`
- **Black:** `#0f172a`

### Extended Color Scale (OKLCH Generated 0-9)
The system uses an OKLCH generated color scale split across 6 hues for fine-grained contrast control.
- **Gray:** `#f8f8f8` to `#060606`
- **Blue:** `#f4f5f6` to `#001157`
- **Green:** `#f4f5f4` to `#002700`
- **Amber:** `#f6f5f4` to `#380700`
- **Red:** `#f6f4f4` to `#480000`
- **Indigo:** `#f4f5f6` to `#0a025a`

---

## 2. Semantic Tokens

Designed to separate meaning from literal color definitions.

### Backgrounds
- `var(--bg-primary)`: `gray-1` *(Base Application Background)*
- `var(--bg-secondary)`: `core-white` *(Cards, Overlays, Input background)*
- `var(--bg-tertiary)`: `gray-1` *(Zebra rows, Secondary interactive areas)*
- `var(--bg-inverse-primary)`: `gray-9`
- `var(--bg-inverse-secondary)`: `gray-8`

### Content (Text and Icons)
- `var(--content-primary)`: `gray-9` *(Headings, strong values)*
- `var(--content-secondary)`: `gray-8` *(Body text)*
- `var(--content-tertiary)`: `gray-7` *(Labels, metadata, descriptive text)*
- `var(--content-quaternary)`: `gray-4` *(Placeholders, disabled text)*
- `var(--content-inverse-primary)`: `core-white`

### Borders
- `var(--border-opaque)`: `gray-3` *(Input outlines, structural dividers)*
- `var(--border-subtle)`: `gray-2` *(Card outlines)*
- `var(--border-faint)` / `var(--border-divider)`: `gray-1` *(Row dividers)*
- `var(--border-selected)`: `gray-9`

### Status Accents
- **Positive (Success):** Background `var(--bg-positive)` (`#16a34a`), Content `var(--content-positive)` (`#166534`), Border `var(--border-positive)` (`#4ade80`).
- **Warning (In-progress):** Background `var(--bg-warning)` (`#f59e0b`), Content `var(--content-warning)` (`#92400e`).
- **Negative (Error):** Background `var(--bg-negative)` (`#dc2626`), Content `var(--content-negative)` (`#b91c1c`).

---

## 3. Role-Based Theming

The application themes the system globally depending on the active user role by injecting overrides into the DOM:

- **Sales (`.role-sales`):** Indigo tones. 
- **Billing (`.role-billing`):** Standard Blue (Core Primary) tones.
- **Picking (`.role-picking`):** Amber / Orange tones.
- **Admin (`.role-admin`):** Gray neutral tones.

*These classes override specific CSS variables such as: `--role-primary`, `--role-primary-subtle`, `--role-content`, and `--bg-row-selected` ensuring buttons, row highlights, and active elements adapt dynamically.*

---

## 4. Spacing, Typography & Density

### Spacing Scale & Touch Targets
- Built on a strict **4pt base grid** (`4`, `8`, `12`, `16`, `24`, `32`, `40`, `48`...).
- **Touch target minimum:** `44px` height (`h-11`) enforced for all standalone interactive elements to meet **WCAG 2.5.8 Target Size** compliance.

### Typography
- **Primary Font:** *Geist Sans*
- **Monospace Font:** *Geist Mono*
- **Focus Rings:** System strips default browser outlines (`outline: none`) and replaces them with standard high-contrast `box-shadow` combined with `border-color`.
- Also accommodates explicitly `.line-clamp-2` utility for dense text areas.

### Density Toggles
System supports structural compression by modifying CSS variables placed on wrapper components:

1. **Comfortable (Default):**
   - Padding: Horizontal `16px`, Vertical `12px`
   - Gaps: Base `16px`, Tight `6px`
   - Labels: `11px` uppercase
   - Body text: `14px`
2. **Compact (`.density-compact`):**
   - Padding: Horizontal `10px`, Vertical `6px`
   - Gaps: Base `12px`, Tight `4px`
   - Labels: `10px` uppercase
   - Body text: `13px`

---

## 5. UI Component Utilities

Rather than relying purely on utility classes everywhere, standard blocks are packaged into reusable CSS classes to enforce consistency:

### 🃏 DS Card (`.ds-card`)
- Base white background, subtle border, `shadow-card` radius `1rem`.
- Interactive (`.ds-card--pressable`): Elevated hover shadows and stronger darker borders.

### 📋 DS Table / Lists (`.ds-table`, `.ds-row`, `.ds-td`, `.ds-th`)
- Highly semantic structural styling for list views and tables.
- Sticky head cells (`.ds-th`) with custom tracking and uppercase micro-labels.
- Built-in interactive row hovers (`--bg-row-hover`) and selected highlight states (`--bg-row-selected`). Supports `.ds-table--zebra`.

### 📝 DS Form Fields (`.ds-field`, `.ds-input`, `.ds-label`)
- Field wrappers group `label` + `input` + `helper/error` cleanly.
- **Labels (`.ds-label`):** Strict all-caps 11px text to build strong hierarchy visually separating label from input text. A non-uppercase prose variant (`.ds-label--prose`) is available.
- **Inputs (`.ds-input`):** Always enforces `16px` font size (essential to prevent auto-zoom in mobile Safari on focus). 

### 🏷️ DS Chips (`.ds-chip`)
- Versatile interactive pills (filter, toggle, status badge).
- Variants included: 
  - `.ds-chip--selected`
  - `.ds-chip--positive`, `.ds-chip--warning`, `.ds-chip--negative`
  - `.ds-chip--role` (Heavy uppercase tracking)
  - `.ds-chip--sm` (Highly compressed)
