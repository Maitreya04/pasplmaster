/**
 * Oddy ST-24 A4 precut (ST-24A4100 / Word template L-7159).
 * 3 across × 8 down = 24 labels per sheet.
 * Label face: 63.5 × 33.86 mm (Oddy / Avery L7159 family).
 *
 * Margins derived to fit 210×297 mm with even gutters (calibrated; use
 * printer scale 100% and adjust 1–2 mm in dialog if your printer feeds slightly off).
 */
export interface PrecutSheetSpec {
  id: string;
  pageWidthMm: number;
  pageHeightMm: number;
  marginTopMm: number;
  marginLeftMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  columns: number;
  rows: number;
  columnGapMm: number;
  rowGapMm: number;
  labelsPerPage: number;
  /** QR column width inside sticker */
  qrColumnMm: number;
  qrSvgMm: number;
}

export const ODDY_ST24_A4: PrecutSheetSpec = {
  id: 'ST-24',
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginTopMm: 4.5,
  marginLeftMm: 5,
  labelWidthMm: 63.5,
  labelHeightMm: 33.86,
  columns: 3,
  rows: 8,
  columnGapMm: 4.75,
  rowGapMm: 2.45,
  labelsPerPage: 24,
  qrColumnMm: 24,
  qrSvgMm: 22,
};

/** Active sheet for Pack Catalog print */
export const PRECUT_SHEET = ODDY_ST24_A4;

function gridTemplateColumns(spec: PrecutSheetSpec): string {
  return Array.from({ length: spec.columns }, () => `${spec.labelWidthMm}mm`).join(' ');
}

export function buildPrecutPrintCss(spec: PrecutSheetSpec = PRECUT_SHEET): string {
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
    top: ${spec.marginTopMm}mm;
    left: ${spec.marginLeftMm}mm;
    display: grid;
    grid-template-columns: ${gridTemplateColumns(spec)};
    grid-template-rows: repeat(${spec.rows}, ${spec.labelHeightMm}mm);
    column-gap: ${spec.columnGapMm}mm;
    row-gap: ${spec.rowGapMm}mm;
  }

  .sticker {
    width: ${spec.labelWidthMm}mm;
    height: ${spec.labelHeightMm}mm;
    overflow: hidden;
    display: grid;
    grid-template-columns: minmax(0, 1fr) ${spec.qrColumnMm}mm;
    align-items: center;
    gap: 1.2mm;
    padding: 1.5mm 1.8mm;
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
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.6mm;
  }

  .sticker-alias {
    font-size: 9.5pt;
    font-weight: 900;
    line-height: 1.02;
    letter-spacing: -0.02em;
    color: #0f172a;
    word-break: break-all;
  }

  .sticker-pack {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 1mm;
    font-size: 6.5pt;
    font-weight: 700;
    line-height: 1.15;
    color: #334155;
  }

  .sticker-pack-tier {
    font-size: 5.5pt;
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
    color: #0f172a;
  }

  .sticker-name {
    font-size: 5pt;
    font-weight: 500;
    color: #64748b;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sticker-qr {
    display: flex;
    align-items: center;
    justify-content: center;
    width: ${spec.qrColumnMm}mm;
    height: ${spec.qrColumnMm}mm;
  }

  .sticker-qr svg {
    display: block;
    width: ${spec.qrSvgMm}mm;
    height: ${spec.qrSvgMm}mm;
    shape-rendering: crispEdges;
  }
`;
}

export const PRECUT_PRINT_CSS = buildPrecutPrintCss(PRECUT_SHEET);

export function chunkLabels<T>(items: T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages;
}
