#!/usr/bin/env node
/**
 * Generates a perceptually uniform (OKLCH) color palette for the design system.
 * Output: palette.json (scale steps 0–9) and optional CSS fragment.
 * Run: node scripts/generate-palette.mjs
 */

import { interpolate, samples, formatHex } from "culori";
import { writeFileSync } from "fs";
import { join } from "path";

const STEPS = 10; // 0–9

function oklch(l, c, h) {
  return { mode: "oklch", l, c, h };
}

// OKLCH: L [0,1], C (chroma), H (hue degrees).
// Lightness from ~0.97 (step 0) down to ~0.15 (step 9) for consistent contrast steps.
function scaleForHue(hue, chroma = 0.12) {
  const light = oklch(0.97, 0.002, hue);
  const dark = oklch(0.22, Math.min(chroma, 0.18), hue);
  const interp = interpolate([light, dark], "oklch");
  return samples(STEPS).map((t) => formatHex(interp(t)));
}

// Gray: zero chroma, neutral. Ease-in so steps 0–2 stay very light (bg, borders).
function grayScale() {
  const easeInQuad = (t) => t * t;
  const ts = samples(STEPS).map(easeInQuad);
  return ts.map((t) => {
    const l = 0.98 * (1 - t) + 0.12 * t;
    return formatHex(oklch(l, 0, 0));
  });
}

const hueBlue = 250;
const hueGreen = 145;
const hueAmber = 75;
const hueRed = 25;
const hueIndigo = 270;

const palette = {
  gray: grayScale(),
  blue: scaleForHue(hueBlue, 0.14),
  green: scaleForHue(hueGreen, 0.13),
  amber: scaleForHue(hueAmber, 0.12),
  red: scaleForHue(hueRed, 0.14),
  // Role hues (optional)
  indigo: scaleForHue(hueIndigo, 0.14), // sales
  // billing reuses blue; picking reuses amber; admin reuses gray
};

const outDir = join(process.cwd(), "src", "design-tokens");
writeFileSync(
  join(outDir, "palette.json"),
  JSON.stringify(palette, null, 2),
  "utf8"
);

// Emit :root and .theme-light CSS fragment for index.css
const g = palette.gray;
const bl = palette.blue;
const gr = palette.green;
const am = palette.amber;
const rd = palette.red;

const css = `/* ─── Palette (OKLCH 0–9) — do not edit by hand; run: node scripts/generate-palette.mjs ─── */
:root {
  --gray-0: ${g[0]};
  --gray-1: ${g[1]};
  --gray-2: ${g[2]};
  --gray-3: ${g[3]};
  --gray-4: ${g[4]};
  --gray-5: ${g[5]};
  --gray-6: ${g[6]};
  --gray-7: ${g[7]};
  --gray-8: ${g[8]};
  --gray-9: ${g[9]};
  --blue-0: ${bl[0]};
  --blue-1: ${bl[1]};
  --blue-2: ${bl[2]};
  --blue-3: ${bl[3]};
  --blue-4: ${bl[4]};
  --blue-5: ${bl[5]};
  --blue-6: ${bl[6]};
  --blue-7: ${bl[7]};
  --blue-8: ${bl[8]};
  --blue-9: ${bl[9]};
  --green-0: ${gr[0]};
  --green-1: ${gr[1]};
  --green-2: ${gr[2]};
  --green-3: ${gr[3]};
  --green-4: ${gr[4]};
  --green-5: ${gr[5]};
  --green-6: ${gr[6]};
  --green-7: ${gr[7]};
  --green-8: ${gr[8]};
  --green-9: ${gr[9]};
  --amber-0: ${am[0]};
  --amber-1: ${am[1]};
  --amber-2: ${am[2]};
  --amber-3: ${am[3]};
  --amber-4: ${am[4]};
  --amber-5: ${am[5]};
  --amber-6: ${am[6]};
  --amber-7: ${am[7]};
  --amber-8: ${am[8]};
  --amber-9: ${am[9]};
  --red-0: ${rd[0]};
  --red-1: ${rd[1]};
  --red-2: ${rd[2]};
  --red-3: ${rd[3]};
  --red-4: ${rd[4]};
  --red-5: ${rd[5]};
  --red-6: ${rd[6]};
  --red-7: ${rd[7]};
  --red-8: ${rd[8]};
  --red-9: ${rd[9]};
}
`;

writeFileSync(join(outDir, "palette-root.css"), css, "utf8");
console.log("Wrote src/design-tokens/palette.json and palette-root.css");
console.log("Integrate palette-root.css into :root and map .theme-light from gray/blue/green/amber/red scales.");
