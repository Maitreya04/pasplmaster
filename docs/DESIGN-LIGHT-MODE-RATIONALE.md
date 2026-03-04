# Light mode design rationale & QA checklist

## A) What changed (CSS)

- **`.theme-light`** semantic tokens were replaced with a premium neutral (slate) palette; see `src/index.css`.
- **Polish layer** (5 rules) added: input/textarea/select focus ring, button transition, primary button hover/active lift and shadow, `--transition-ui` and `--border-divider`.
- **Divider** component now uses `--border-divider` so dividers are softer in light mode.

---

## B) Design system structure: Core / Accent / Greys

The color system is organized into three tiers (see `src/index.css`):

| Tier | Purpose | Primitives | Semantic usage |
|------|---------|------------|-----------------|
| **Core** | Brand + base surfaces and text | `--core-primary`, `--core-white`, `--core-black` | Primary brand blue, page/card backgrounds, primary text and inverse buttons. Change `--core-primary` for a global brand tint (e.g. desaturated blue). |
| **Accent** | Intents and role highlights | `--bg-accent`, `--content-accent`, `--bg-positive`, etc. + `--role-*` overrides | CTAs, status (success/warning/error), role badges (Sales, Billing, Picking, Admin). |
| **Greys** | Neutrals and hierarchy | `--grey-50` … `--grey-950` | Borders, secondary/tertiary text, row hovers, dividers. Single scale so borders and text stay consistent. |

- **In components:** use semantic tokens only (`--bg-primary`, `--content-primary`, `--role-primary`, etc.). Primitives are for theming and one-place edits.
- **To soften the brand:** set `--core-primary` to a desaturated blue (e.g. `#3d5a73`); to retune neutrals, edit the `--grey-*` scale.

---

## C) Rationale by token group

### Background
- **`--bg-primary`** — Grey-100; page background so content doesn’t sit on pure white.
- **`--bg-secondary`** — Core white; cards and panels.
- **`--bg-tertiary`** — Grey-100; inputs and hover areas.
- **`--bg-inverse-*`** — Core black / Grey-800 for primary buttons.
- **`--bg-overlay`** — Slate-tinted overlay for modals.

### Content
- **`--content-primary`** — Grey-900; strong contrast, WCAG AA.
- **`--content-secondary`** / **`--content-tertiary`** / **`--content-quaternary`** — Grey-700 / 500 / 400 for hierarchy.
- **`--content-disabled`** — Grey-400.

### Border
- **`--border-opaque`** — Grey-200; visible dividers and input borders.
- **`--border-subtle`** / **`--border-faint`** — Grey-100; row and card edges.
- **`--border-divider`** — New token for horizontal rules; in light it’s the lightest border so lists/tables feel calm.

### Accent
- **Accent / positive / warning / negative** — Same hue family; subtle variants at 7% opacity so badges/chips stay legible and not pastel.
- **Content** — Slightly deeper shades (e.g. `#1d4ed8`, `#15803d`) for text on light backgrounds.
- **Borders** — Softer border tokens for focus and intent (e.g. blue/amber) so rings don’t feel loud.

### Role accents
- **`--role-primary`** / **`--role-content`** overridden per area; **`--role-hero-bg`** (Sales) is a desaturated blue for the hero card.

---

## D) QA checklist for ERP screens

Use this when checking that light mode stays clear and consistent.

### List density
- [ ] Long lists (orders, items, picks) use `--border-faint` or `--border-divider` between rows, not heavy borders.
- [ ] Row hover uses `--bg-row-hover`; selected row uses `--bg-row-selected` (role-aware where applicable).
- [ ] List blocks feel like “rows” (dividers + spacing), not a stack of heavy cards.

### Form readability
- [ ] Labels use a clear hierarchy (e.g. `--content-secondary` / `--content-tertiary`).
- [ ] Inputs have a visible border (`--border-opaque`) and focus ring (role primary + subtle shadow).
- [ ] Helper and error text use `--content-quaternary` and `--content-negative`; disabled fields use `--content-disabled`.

### Modal / overlay layering
- [ ] Backdrop uses `--bg-overlay`; content uses `--bg-secondary` or `--bg-elevated` and `--shadow-card`.
- [ ] Focus is trapped and visible (focus ring on inputs/buttons).

### Focus visibility
- [ ] All focusable controls show a clear focus state (keyboard only is fine).
- [ ] Input/textarea/select focus uses the Stripe-style ring (border + 3px `--role-primary-subtle`).
- [ ] No focus outline removed without a visible replacement.

### Button hierarchy
- [ ] Primary (inverse) buttons have hover lift and shadow; active has slight press.
- [ ] Secondary/ghost buttons don’t compete; hover is subtle (e.g. opacity or background change).
- [ ] Danger actions stay clearly distinct (e.g. `--content-negative`).

---

## E) UI UX Pro Max pre-delivery checklist

Use this when building or reviewing new UI so it stays consistent and accessible.

- [ ] **Icons:** No emojis as icons — use SVG (e.g. Lucide, Heroicons).
- [ ] **Clickables:** `cursor-pointer` on all interactive elements.
- [ ] **Motion:** Hover/transition duration 150–300ms; respect `prefers-reduced-motion` (handled in `index.css`).
- [ ] **Contrast:** Light mode text contrast ≥ 4.5:1 (semantic tokens in `index.css` are chosen for this).
- [ ] **Focus:** Visible focus state for keyboard nav; no `outline: none` without a replacement (ring/offset).
- [ ] **Responsive:** Consider 375px, 768px, 1024px, 1440px when laying out.
