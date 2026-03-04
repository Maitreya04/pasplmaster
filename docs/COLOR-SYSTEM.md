# Accessible color system (OKLCH palette + contrast)

This project uses an OKLCH-based palette and semantic tokens to keep **theme-light** accessible (WCAG 2: 4.5:1 text, 3:1 large/icon).

## Palette

- **Source:** `src/design-tokens/palette.json` (generated; do not edit by hand).
- **Scales (steps 0–9):** `gray`, `blue`, `green`, `amber`, `red`, `indigo` (role: sales).
- **Generation:** `node scripts/generate-palette.mjs` (writes `palette.json` and `src/design-tokens/palette-root.css`).
- **Scripts:**
  - `npm run tokens:generate` — regenerate palette from OKLCH.
  - `npm run test:contrast` — run WCAG 2 contrast checks for theme-light pairs.

## Contrast test

The script `scripts/contrast-test.mjs` checks:

- **Text (≥ 4.5:1):** content-primary/secondary/tertiary on bg-primary, bg-secondary, bg-elevated; content-accent on bg-primary/bg-secondary; content-on-color on bg-accent/positive/warning/negative; content-positive/warning/negative on their subtle backgrounds.
- **Large/icon (≥ 3:1):** same pairs with relaxed threshold where applicable.

Run locally:

```bash
npm run test:contrast
```

**CI:** Add a step that runs `npm run test:contrast` (e.g. in the same job as `npm run lint` or `npm run build`). Exit code 1 on any failure.

Example (GitHub Actions):

```yaml
- name: Contrast
  run: npm run test:contrast
```

## Theme-light mapping

`.theme-light` in `src/index.css` maps semantic tokens to the palette:

- **Backgrounds:** gray-1 (page), core-white (cards), gray-9/8 (inverse).
- **Content:** gray-9 (primary), gray-8 (secondary), gray-7 (tertiary), gray-4 (quaternary/disabled).
- **Borders:** gray-3 (opaque), gray-2 (subtle), gray-1 (faint/divider).
- **Accent/intent:** blue-7/9/2 (accent), green-7/9/2 (positive), amber-7/9/2 (warning), red-7/9/2 (negative).
- **Roles:** indigo (sales), blue (billing), amber (picking), gray (admin).

Fonts remain **Geist Sans** / **Geist Mono**.
