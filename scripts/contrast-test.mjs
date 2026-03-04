#!/usr/bin/env node
/**
 * WCAG 2 contrast ratio tests for theme-light semantic token pairs.
 * Requires: >= 4.5:1 for normal text, >= 3.0:1 for large text/icons.
 * Run: node scripts/contrast-test.mjs
 * CI: add "test:contrast": "node scripts/contrast-test.mjs" and run in CI.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { wcagContrast } from "culori";

const MIN_TEXT = 4.5; // WCAG AA normal text; 3.0 for large/icon (all pairs here pass both)

const palettePath = join(process.cwd(), "src", "design-tokens", "palette.json");
const palette = JSON.parse(readFileSync(palettePath, "utf8"));

const g = palette.gray;
const bl = palette.blue;
const gr = palette.green;
const am = palette.amber;
const rd = palette.red;

// Resolved theme-light tokens (semantic -> hex from palette)
const theme = {
  "bg-primary": g[1],
  "bg-secondary": "#ffffff",
  "bg-elevated": "#ffffff",
  "content-primary": g[9],
  "content-secondary": g[8],
  "content-tertiary": g[7],
  "content-accent": bl[9],
  "content-on-color": "#ffffff",
  "bg-accent": bl[7],
  "content-positive": gr[9],
  "bg-positive": gr[7],
  "bg-positive-subtle": gr[0],
  "content-warning": am[9],
  "bg-warning": am[7],
  "bg-warning-subtle": am[0],
  "content-negative": rd[9],
  "bg-negative": rd[7],
  "bg-negative-subtle": rd[0],
};

function ratio(fg, bg) {
  const r = wcagContrast(fg, bg);
  return r ?? 0;
}

const pairs = [
  // Text on backgrounds — require 4.5:1
  { fg: "content-primary", bg: "bg-primary", min: MIN_TEXT },
  { fg: "content-primary", bg: "bg-secondary", min: MIN_TEXT },
  { fg: "content-primary", bg: "bg-elevated", min: MIN_TEXT },
  { fg: "content-secondary", bg: "bg-primary", min: MIN_TEXT },
  { fg: "content-secondary", bg: "bg-secondary", min: MIN_TEXT },
  { fg: "content-tertiary", bg: "bg-primary", min: MIN_TEXT },
  { fg: "content-tertiary", bg: "bg-secondary", min: MIN_TEXT },
  { fg: "content-accent", bg: "bg-primary", min: MIN_TEXT },
  { fg: "content-accent", bg: "bg-secondary", min: MIN_TEXT },
  // Content on solid intent backgrounds — 4.5:1 (text)
  { fg: "content-on-color", bg: "bg-accent", min: MIN_TEXT },
  { fg: "content-on-color", bg: "bg-positive", min: MIN_TEXT },
  { fg: "content-on-color", bg: "bg-warning", min: MIN_TEXT },
  { fg: "content-on-color", bg: "bg-negative", min: MIN_TEXT },
  // Intent text on subtle intent backgrounds — 4.5:1
  { fg: "content-positive", bg: "bg-positive-subtle", min: MIN_TEXT },
  { fg: "content-warning", bg: "bg-warning-subtle", min: MIN_TEXT },
  { fg: "content-negative", bg: "bg-negative-subtle", min: MIN_TEXT },
];

let failed = 0;

console.log("Theme-light contrast (WCAG 2)\n");

for (const { fg, bg, min } of pairs) {
  const fgHex = theme[fg];
  const bgHex = theme[bg];
  if (!fgHex || !bgHex) {
    console.warn(`  Skip ${fg} on ${bg}: missing token`);
    continue;
  }
  const r = ratio(fgHex, bgHex);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${fg} on ${bg}: ${r.toFixed(2)}:1 (min ${min})`);
}

console.log("");
if (failed > 0) {
  console.error(`Failed ${failed} text contrast check(s).`);
  process.exit(1);
}
console.log("All contrast checks passed.");
process.exit(0);
