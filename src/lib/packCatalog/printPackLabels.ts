import QRCode from 'qrcode';
import { aliasDisplayForItem, receivingItemPickPayload } from '../labels/packStripPrint';
import { packPickPayload } from '../receiving/receivingPrintUtils';
import type { Item } from '../../types';
import {
  buildPrecutPrintCss,
  chunkLabels,
  getPrecutSheet,
  precutLabelPosition,
  precutSheetSummary,
  type PrecutPrintOffsets,
  type PrecutSheetSpec,
} from './precutSheetLayout';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type LabelTier = 'outer' | 'inner' | 'piece';

interface PrecutLabelCell {
  tier: LabelTier;
  tierLabel: string;
  packQty: number;
  scanHint: string;
  aliasHeading: string;
  itemName: string;
  qrSvg: string;
}

async function buildPackOnlyQr(busyCode: number, packType: 'inner' | 'outer'): Promise<string> {
  const payload = packPickPayload(busyCode, packType);
  return QRCode.toString(payload, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    width: 256,
  });
}

async function buildItemQr(
  item: Item,
  busyCode: number,
): Promise<string> {
  const payload = receivingItemPickPayload(item, busyCode);
  return QRCode.toString(payload, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
    width: 256,
  });
}

function stickerPositionStyle(
  spec: PrecutSheetSpec,
  index: number,
  offsets?: PrecutPrintOffsets,
): string {
  const { leftMm, topMm } = precutLabelPosition(spec, index, offsets);
  return `left:${leftMm}mm;top:${topMm}mm`;
}

function renderSticker(
  cell: PrecutLabelCell,
  index: number,
  spec: PrecutSheetSpec,
  offsets?: PrecutPrintOffsets,
): string {
  const tierAttr = cell.tier === 'inner' ? 'inner' : cell.tier === 'piece' ? 'piece' : 'outer';
  const qtyLine = cell.tier === 'piece' ? '1 pc' : `${cell.packQty} pcs`;
  const tierShort =
    cell.tier === 'piece' ? 'Piece' : cell.tier === 'inner' ? 'Inner' : 'Outer';
  const pos = stickerPositionStyle(spec, index, offsets);
  return `<div class="sticker" style="${pos}">
    <div class="sticker-copy">
      <div class="sticker-alias">${escapeHtml(cell.aliasHeading)}</div>
      <div class="sticker-pack">
        <span class="sticker-pack-tier" data-tier="${tierAttr}">${escapeHtml(tierShort)}</span>
        <span class="sticker-pack-qty">${escapeHtml(qtyLine)}</span>
      </div>
      <div class="sticker-name">${escapeHtml(cell.itemName)}</div>
    </div>
    <div class="sticker-qr" aria-label="${escapeHtml(cell.scanHint)}">${cell.qrSvg}</div>
  </div>`;
}

function renderSheet(
  cells: PrecutLabelCell[],
  sheetIndex: number,
  totalSheets: number,
  spec: PrecutSheetSpec,
  offsets?: PrecutPrintOffsets,
): string {
  const padded = [...cells];
  while (padded.length < spec.labelsPerPage) {
    padded.push({
      tier: 'piece',
      tierLabel: '',
      packQty: 0,
      scanHint: '',
      aliasHeading: '',
      itemName: '',
      qrSvg: '',
    });
  }
  const visible = padded.slice(0, spec.labelsPerPage);
  const stickers = visible
    .map((cell, index) => {
      const pos = stickerPositionStyle(spec, index, offsets);
      if (cell.qrSvg) return renderSticker(cell, index, spec, offsets);
      return `<div class="sticker" style="${pos}"></div>`;
    })
    .join('');

  const header =
    sheetIndex === 0
      ? `<p class="screen-only" style="margin:8px auto;max-width:210mm;font-size:11px;color:#64748b;text-align:center">
      ${precutSheetSummary(spec)} · pack QR on cartons · piece QR on individuals
    </p>`
      : '';

  return `${header}<div class="precut-sheet" data-sheet="${sheetIndex + 1}-of-${totalSheets}">
    <div class="precut-grid">${stickers}</div>
  </div>`;
}

export interface PackCatalogPrintSelection {
  outerCount: number;
  innerCount: number;
  individualCount: number;
}

export async function openPackCatalogLabelsPrint(opts: {
  item: Item;
  busyCode: number;
  outerPackQty: number | null;
  innerPackQty: number | null;
  sellUnit: string;
  structure: string | null;
  selection: PackCatalogPrintSelection;
  offsets?: PrecutPrintOffsets;
  /** When false, opens a full-size on-screen sheet (dashed cells) without triggering print. */
  autoPrint?: boolean;
}): Promise<{ cardCount: number; blocked: boolean }> {
  const spec = getPrecutSheet();
  const w = window.open('', '_blank');
  if (!w) return { cardCount: 0, blocked: true };

  const { item, busyCode, selection } = opts;
  const alias = aliasDisplayForItem(item);
  const itemName = item.name.length > 72 ? `${item.name.slice(0, 69)}…` : item.name;
  const cells: PrecutLabelCell[] = [];

  if (selection.outerCount > 0 && opts.outerPackQty != null && opts.outerPackQty >= 1) {
    const qrSvg = await buildPackOnlyQr(busyCode, 'outer');
    for (let i = 0; i < selection.outerCount; i += 1) {
      cells.push({
        tier: 'outer',
        tierLabel: 'Outer box',
        packQty: opts.outerPackQty,
        scanHint: `Scan +${opts.outerPackQty} pcs`,
        aliasHeading: alias.heading,
        itemName,
        qrSvg,
      });
    }
  }

  if (selection.innerCount > 0 && opts.innerPackQty != null && opts.innerPackQty >= 1) {
    const qrSvg = await buildPackOnlyQr(busyCode, 'inner');
    for (let i = 0; i < selection.innerCount; i += 1) {
      cells.push({
        tier: 'inner',
        tierLabel: 'Inner box',
        packQty: opts.innerPackQty,
        scanHint: `Scan +${opts.innerPackQty} pcs`,
        aliasHeading: alias.heading,
        itemName,
        qrSvg,
      });
    }
  }

  if (selection.individualCount > 0 && opts.sellUnit !== 'PACK') {
    const qrSvg = await buildItemQr(item, busyCode);
    for (let i = 0; i < selection.individualCount; i += 1) {
      cells.push({
        tier: 'piece',
        tierLabel: 'Individual',
        packQty: 1,
        scanHint: 'Scan +1 pc',
        aliasHeading: alias.heading,
        itemName,
        qrSvg,
      });
    }
  }

  const cardCount = cells.length;
  if (cardCount === 0) {
    w.close();
    return { cardCount: 0, blocked: false };
  }

  const pages = chunkLabels(cells, spec.labelsPerPage);
  const sheetsHtml = pages
    .map((pageCells, idx) => renderSheet(pageCells, idx, pages.length, spec, opts.offsets))
    .join('');

  const autoPrint = opts.autoPrint !== false;
  const printCss = buildPrecutPrintCss(spec, opts.offsets);
  const printScript = autoPrint
    ? '<script>window.onload=function(){window.print();}</script>'
    : `<p class="screen-only" style="margin:12px auto;max-width:210mm;font-size:12px;color:#64748b;text-align:center">
        Preview only — use the browser Print button when ready (100% scale, no fit-to-page).
      </p>`;

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pack labels — ${escapeHtml(alias.heading)}</title>
    <style>${printCss}</style></head><body>
    ${sheetsHtml}
    ${printScript}
  </body></html>`);
  w.document.close();

  return { cardCount, blocked: false };
}
