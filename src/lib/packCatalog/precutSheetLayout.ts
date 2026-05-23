/**
 * Oddy A4 precut sheets — layout matches manufacturer / Word label dialogs:
 * top margin, side margin, horizontal pitch, vertical pitch, label width & height.
 * Each label is placed at side + col×H-pitch, top + row×V-pitch (not CSS grid gaps).
 */
export interface PrecutSheetSpec {
  id: string;
  name: string;
  pageWidthMm: number;
  pageHeightMm: number;
  topMarginMm: number;
  sideMarginMm: number;
  horizontalPitchMm: number;
  verticalPitchMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  columns: number;
  rows: number;
  labelsPerPage: number;
  qrColumnMm: number;
  qrSvgMm: number;
  /** Inner safe zone from die-cut edge (mm). */
  labelPaddingMm: number;
  aliasFontPt: number;
  packFontPt: number;
  nameFontPt: number;
}

/**
 * Oddy ST-24 A4100 (24-up A4) — official dimensions table / Word L-7159.
 * Source: Oddy multipurpose labels dimension identification table.
 */
export const ODDY_ST24_A4: PrecutSheetSpec = {
  id: 'ST-24A4100',
  name: 'Oddy ST-24 A4100 (L-7159)',
  pageWidthMm: 210,
  pageHeightMm: 297,
  topMarginMm: 12.979,
  sideMarginMm: 4.597,
  horizontalPitchMm: 66.472,
  verticalPitchMm: 33.858,
  labelWidthMm: 64,
  labelHeightMm: 34,
  columns: 3,
  rows: 8,
  labelsPerPage: 24,
  qrColumnMm: 18,
  qrSvgMm: 16,
  labelPaddingMm: 4,
  aliasFontPt: 9,
  packFontPt: 6,
  nameFontPt: 4.5,
};

/** Active Oddy precut sheet for Pack Catalog print. */
export const PRECUT_SHEET = ODDY_ST24_A4;

export function getPrecutSheet(): PrecutSheetSpec {
  return PRECUT_SHEET;
}

/** Fine-tune when a printer feeds slightly off (mm), applied on top of margins. */
export interface PrecutPrintOffsets {
  topMm: number;
  leftMm: number;
}

export const PRECUT_PRINT_OFFSET_STORAGE_KEY = 'paspl.pack-catalog.precut-offset';

export function loadPrecutPrintOffsets(): PrecutPrintOffsets {
  try {
    const raw = localStorage.getItem(PRECUT_PRINT_OFFSET_STORAGE_KEY);
    if (!raw) return { topMm: 0, leftMm: 0 };
    const parsed = JSON.parse(raw) as Partial<PrecutPrintOffsets>;
    return {
      topMm: typeof parsed.topMm === 'number' ? parsed.topMm : 0,
      leftMm: typeof parsed.leftMm === 'number' ? parsed.leftMm : 0,
    };
  } catch {
    return { topMm: 0, leftMm: 0 };
  }
}

export function savePrecutPrintOffsets(offsets: PrecutPrintOffsets): void {
  localStorage.setItem(PRECUT_PRINT_OFFSET_STORAGE_KEY, JSON.stringify(offsets));
}

export function precutLabelPosition(
  spec: PrecutSheetSpec,
  index: number,
  offsets: PrecutPrintOffsets = { topMm: 0, leftMm: 0 },
): { leftMm: number; topMm: number; col: number; row: number } {
  const col = index % spec.columns;
  const row = Math.floor(index / spec.columns);
  return {
    col,
    row,
    leftMm: spec.sideMarginMm + col * spec.horizontalPitchMm + offsets.leftMm,
    topMm: spec.topMarginMm + row * spec.verticalPitchMm + offsets.topMm,
  };
}

/** Human-readable line matching Oddy / Word label dialog fields. */
export function precutOddyDialogSummary(spec: PrecutSheetSpec): string {
  return [
    `top ${spec.topMarginMm}`,
    `side ${spec.sideMarginMm}`,
    `H pitch ${spec.horizontalPitchMm}`,
    `V pitch ${spec.verticalPitchMm}`,
    `${spec.labelWidthMm}×${spec.labelHeightMm} mm`,
    `${spec.columns}×${spec.rows}`,
  ].join(' · ');
}

export function precutSheetSummary(spec: PrecutSheetSpec): string {
  return `${spec.name} · ${spec.labelsPerPage}/sheet · ${precutOddyDialogSummary(spec)}`;
}

export function buildPrecutPrintCss(
  spec: PrecutSheetSpec = getPrecutSheet(),
  _offsets: PrecutPrintOffsets = { topMm: 0, leftMm: 0 },
): string {
  return `
  @page {
    size: A4 portrait;
    margin: 0;
  }

  * {
    box-sizing: border-box;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #0f172a;
    font-family: system-ui, -apple-system, sans-serif;
  }

  .precut-sheet {
    width: ${spec.pageWidthMm}mm;
    height: ${spec.pageHeightMm}mm;
    position: relative;
    page-break-after: always;
    break-after: page;
    background: #fff;
  }

  .precut-sheet:last-child {
    page-break-after: auto;
    break-after: auto;
  }

  .precut-grid {
    position: absolute;
    inset: 0;
    width: ${spec.pageWidthMm}mm;
    height: ${spec.pageHeightMm}mm;
  }

  .sticker {
    position: absolute;
    margin: 0;
    width: ${spec.labelWidthMm}mm;
    height: ${spec.labelHeightMm}mm;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: ${spec.labelPaddingMm}mm;
  }

  .sticker-body {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2mm;
    width: 100%;
    max-height: 100%;
    min-width: 0;
  }

  @media screen {
    .sticker {
      outline: 0.12mm dashed #cbd5e1;
      outline-offset: -0.12mm;
    }
    .precut-sheet {
      margin: 8px auto;
      box-shadow: 0 0 0 1px #e2e8f0;
    }
  }

  @media print {
    .sticker {
      outline: none;
    }
    .screen-only {
      display: none !important;
    }
  }

  .sticker-copy {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 0.45mm;
  }

  .sticker-alias {
    font-size: ${spec.aliasFontPt}pt;
    font-weight: 900;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: #000000;
    word-break: break-word;
    hyphens: auto;
    max-width: 100%;
  }

  .sticker-pack {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: center;
    gap: 0.8mm;
    font-size: ${spec.packFontPt}pt;
    font-weight: 700;
    line-height: 1.15;
    color: #334155;
  }

  .sticker-pack-tier {
    font-size: ${Math.max(spec.packFontPt - 1, 5)}pt;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #0369a1;
  }

  .sticker-pack-tier[data-tier="inner"] {
    color: #047857;
  }

  .sticker-pack-tier[data-tier="piece"] {
    color: #64748b;
  }

  .sticker-pack-qty {
    font-variant-numeric: tabular-nums;
    font-weight: 800;
    color: #000000;
  }

  .sticker-name {
    font-size: ${spec.nameFontPt}pt;
    font-weight: 600;
    line-height: 1.12;
    color: #000000;
    text-align: center;
    max-width: 100%;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    word-break: break-word;
    hyphens: auto;
  }

  .sticker-qr {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: ${spec.qrColumnMm}mm;
    height: ${spec.qrColumnMm}mm;
    padding: 0.35mm;
  }

  .sticker-qr svg {
    display: block;
    width: ${spec.qrSvgMm}mm;
    height: ${spec.qrSvgMm}mm;
    shape-rendering: crispEdges;
  }
`;
}

export function chunkLabels<T>(items: T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages;
}
