/** Print helpers for receiving labels — PASPL-PACK + ITEM alias (same as Label Studio). */

import {
  buildPieceReceivingLabelCards,
  buildUnifiedReceivingLabelCards,
  type ReceivingPieceLabelCard,
  type ReceivingUnifiedLabelCard,
} from '../labels/packStripPrint';
import { parseRackPayload } from '../scanner/qrPayload';
import type { Item } from '../../types';

export type { ReceivingUnifiedLabelCard, ReceivingPieceLabelCard };

export function packPickPayload(busyCode: number, packType: 'inner' | 'outer'): string {
  return `PASPL-PACK:${busyCode}:${packType}`;
}

export interface ReceivingPrintPlate {
  lpn_code: string;
  pack_type: string;
  pack_qty: number;
  receiving_lot: string | null;
  receiving_pack_seq?: number | null;
}

const PRINT_STYLES = `
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 8px; color: #0f172a; background: #fff; }
  h1 { font-size: 14px; margin: 0 0 8px; font-weight: 800; }
  .meta { font-size: 11px; color: #475569; margin-bottom: 10px; line-height: 1.4; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6mm; }
  .card {
    border: 1px solid #94a3b8; border-radius: 6px; padding: 8px;
    break-inside: avoid; page-break-inside: avoid;
    min-height: 58mm;
    display: flex; flex-direction: column;
  }
  .tier { font-size: 9px; font-weight: 800; letter-spacing: 0.06em; color: #0369a1; text-transform: uppercase; }
  .alias { font-size: 15px; font-weight: 800; margin-top: 4px; line-height: 1.15; word-break: break-all; }
  .alias-foot { font-size: 9px; color: #64748b; margin-top: 2px; }
  .sku { font-size: 10px; color: #334155; margin-top: 4px; }
  .lot { font-size: 10px; color: #64748b; margin-top: 2px; }
  .qty { font-size: 11px; font-weight: 600; margin-top: 4px; }
  .lpn { font-family: ui-monospace, monospace; font-size: 9px; color: #64748b; margin-top: 4px; word-break: break-all; }
  .qr-row { display: flex; gap: 8px; justify-content: center; margin-top: auto; padding-top: 6px; }
  .qr-block { text-align: center; flex: 1; }
  .qr-label { font-size: 8px; font-weight: 700; text-transform: uppercase; color: #64748b; margin-bottom: 2px; }
  .qr svg { max-width: 64px; height: auto; }
  .seq { font-size: 9px; color: #94a3b8; text-align: right; margin-top: 2px; }
`;

function renderCard(opts: {
  tierLabel: string;
  lineBusyCode: number;
  skuDescription: string;
  poRef?: string | null;
  card: ReceivingUnifiedLabelCard;
}): string {
  const { card } = opts;
  const footnote = card.aliasFootnote
    ? `<div class="alias-foot">${escapeHtml(card.aliasFootnote)}</div>`
    : '';
  const poLine = opts.poRef ? `<div class="lot">PO ${escapeHtml(opts.poRef)}</div>` : '';
  const seq = card.indexOfTotal ? `<div class="seq">${escapeHtml(card.indexOfTotal)}</div>` : '';
  return `<div class="card">
      <div class="tier">${escapeHtml(opts.tierLabel)}</div>
      <div class="alias">${escapeHtml(card.aliasHeading)}</div>
      ${footnote}
      <div class="sku">Busy ${opts.lineBusyCode} · ${escapeHtml(opts.skuDescription.slice(0, 100))}</div>
      <div class="lot">Lot ${escapeHtml(card.plate.receiving_lot ?? '—')}</div>
      <div class="qty">${card.plate.pack_qty} ea in this carton</div>
      ${poLine}
      <div class="lpn">LPN ${escapeHtml(card.plate.lpn_code)}</div>
      <div class="qr-row">
        <div class="qr-block"><div class="qr-label">Pack</div><div class="qr">${card.packQrSvg}</div></div>
        <div class="qr-block"><div class="qr-label">Item</div><div class="qr">${card.itemQrSvg}</div></div>
      </div>
      ${seq}
    </div>`;
}

/**
 * Opens a print window with unified receiving labels (PASPL-PACK + ITEM QRs).
 */
export function openReceivingLabelsPrint(opts: {
  documentTitle: string;
  jobPublicId: string | null;
  envelopeCode: string | null;
  poRef?: string | null;
  lineBusyCode: number;
  skuDescription: string;
  tierLabel: string;
  cards: ReceivingUnifiedLabelCard[];
}): void {
  const w = window.open('', '_blank');
  if (!w) return;

  const cardsHtml = opts.cards
    .map((card) =>
      renderCard({
        tierLabel: opts.tierLabel,
        lineBusyCode: opts.lineBusyCode,
        skuDescription: opts.skuDescription,
        poRef: opts.poRef,
        card,
      }),
    )
    .join('')

  const head = opts.jobPublicId ? `${escapeHtml(opts.jobPublicId)}` : 'Receiving';
  const env = opts.envelopeCode ? ` · ${escapeHtml(opts.envelopeCode)}` : '';

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.documentTitle)}</title>
    <style>${PRINT_STYLES}</style>
  </head><body>
    <h1>${head}${env}</h1>
    <div class="meta">${escapeHtml(opts.tierLabel)} · scan <strong>Pack</strong> or <strong>Item</strong> QR (same as pick floor)</div>
    <div class="grid">${cardsHtml}</div>
    <script>window.onload=function(){window.print();}</script>
  </body></html>`);
  w.document.close();
}

function renderPieceCard(opts: {
  lineBusyCode: number;
  skuDescription: string;
  lotNo: string;
  poRef?: string | null;
  card: ReceivingPieceLabelCard;
}): string {
  const footnote = opts.card.aliasFootnote
    ? `<div class="alias-foot">${escapeHtml(opts.card.aliasFootnote)}</div>`
    : '';
  const poLine = opts.poRef ? `<div class="lot">PO ${escapeHtml(opts.poRef)}</div>` : '';
  return `<div class="card">
      <div class="tier">Piece (each)</div>
      <div class="alias">${escapeHtml(opts.card.aliasHeading)}</div>
      ${footnote}
      <div class="sku">Busy ${opts.lineBusyCode} · ${escapeHtml(opts.skuDescription.slice(0, 100))}</div>
      <div class="lot">Lot ${escapeHtml(opts.lotNo)}</div>
      ${poLine}
      <div class="qr-row">
        <div class="qr-block"><div class="qr-label">Item</div><div class="qr">${opts.card.itemQrSvg}</div></div>
      </div>
      <div class="seq">${escapeHtml(opts.card.indexOfTotal)}</div>
    </div>`;
}

/** One print job: outer LPN cards, inner LPN cards, then piece ITEM stickers. */
export async function openReceivingBulkLabelsPrint(opts: {
  documentTitle: string;
  jobPublicId: string | null;
  envelopeCode: string | null;
  poRef?: string | null;
  lineBusyCode: number;
  skuDescription: string;
  lotNo: string;
  plates: ReceivingPrintPlate[];
  pieceLabelCount: number;
  catalogItem: Pick<Item, 'alias1' | 'alias'> | null;
}): Promise<void> {
  const [outerCards, innerCards, pieceCards] = await Promise.all([
    buildUnifiedReceivingLabelCards({
      plates: opts.plates,
      packType: 'outer',
      busyCode: opts.lineBusyCode,
      item: opts.catalogItem,
    }),
    buildUnifiedReceivingLabelCards({
      plates: opts.plates,
      packType: 'inner',
      busyCode: opts.lineBusyCode,
      item: opts.catalogItem,
    }),
    buildPieceReceivingLabelCards({
      count: opts.pieceLabelCount,
      busyCode: opts.lineBusyCode,
      lotNo: opts.lotNo,
      item: opts.catalogItem,
    }),
  ]);

  const sections: string[] = [];
  if (outerCards.length > 0) {
    sections.push(
      `<h2 class="section-h">Outer labels (${outerCards.length})</h2><div class="grid">${outerCards
        .map((card) =>
          renderCard({
            tierLabel: 'Outer carton',
            lineBusyCode: opts.lineBusyCode,
            skuDescription: opts.skuDescription,
            poRef: opts.poRef,
            card,
          }),
        )
        .join('')}</div>`,
    );
  }
  if (innerCards.length > 0) {
    sections.push(
      `<h2 class="section-h">Inner labels (${innerCards.length})</h2><div class="grid">${innerCards
        .map((card) =>
          renderCard({
            tierLabel: 'Inner pack',
            lineBusyCode: opts.lineBusyCode,
            skuDescription: opts.skuDescription,
            poRef: opts.poRef,
            card,
          }),
        )
        .join('')}</div>`,
    );
  }
  if (pieceCards.length > 0) {
    sections.push(
      `<h2 class="section-h">Piece labels (${pieceCards.length})</h2><div class="grid">${pieceCards
        .map((card) =>
          renderPieceCard({
            lineBusyCode: opts.lineBusyCode,
            skuDescription: opts.skuDescription,
            lotNo: opts.lotNo,
            poRef: opts.poRef,
            card,
          }),
        )
        .join('')}</div>`,
    );
  }

  if (sections.length === 0) return;

  const w = window.open('', '_blank');
  if (!w) return;

  const head = opts.jobPublicId ? escapeHtml(opts.jobPublicId) : 'Receiving';
  const env = opts.envelopeCode ? ` · ${escapeHtml(opts.envelopeCode)}` : '';
  const sectionStyles = `
  .section-h { font-size: 12px; margin: 12px 0 6px; font-weight: 800; color: #0369a1; }
  .section-h:first-of-type { margin-top: 0; }
  `;

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.documentTitle)}</title>
    <style>${PRINT_STYLES}${sectionStyles}</style>
  </head><body>
    <h1>${head}${env}</h1>
    <div class="meta">Busy ${opts.lineBusyCode} · scan <strong>Pack</strong> or <strong>Item</strong> QR</div>
    ${sections.join('')}
    <script>window.onload=function(){window.print();}</script>
  </body></html>`);
  w.document.close();
}

export interface ReceivingBatchLineInput {
  lineBusyCode: number;
  skuDescription: string;
  lotNo: string;
  plates: ReceivingPrintPlate[];
  catalogItem: Pick<import('../../types').Item, 'alias1' | 'alias'> | null;
  includeMaster: boolean;
  includeInner: boolean;
  pieceLabelCount: number;
}

/** One print window for many GRN lines — sections per SKU, master/inner/piece grouped. */
export async function openReceivingBatchPrint(opts: {
  documentTitle: string;
  jobPublicId: string | null;
  envelopeCode: string | null;
  poRef?: string | null;
  phaseLabel: string;
  lines: ReceivingBatchLineInput[];
}): Promise<{ opened: boolean; cardCount: number }> {
  const lineSections: string[] = [];
  let cardCount = 0;

  for (const ln of opts.lines) {
    const [outerCards, innerCards, pieceCards] = await Promise.all([
      ln.includeMaster
        ? buildUnifiedReceivingLabelCards({
            plates: ln.plates,
            packType: 'outer',
            busyCode: ln.lineBusyCode,
            item: ln.catalogItem,
          })
        : Promise.resolve([] as ReceivingUnifiedLabelCard[]),
      ln.includeInner
        ? buildUnifiedReceivingLabelCards({
            plates: ln.plates,
            packType: 'inner',
            busyCode: ln.lineBusyCode,
            item: ln.catalogItem,
          })
        : Promise.resolve([] as ReceivingUnifiedLabelCard[]),
      ln.pieceLabelCount > 0
        ? buildPieceReceivingLabelCards({
            count: ln.pieceLabelCount,
            busyCode: ln.lineBusyCode,
            lotNo: ln.lotNo,
            item: ln.catalogItem,
          })
        : Promise.resolve([] as ReceivingPieceLabelCard[]),
    ]);

    const tierSections: string[] = [];
    cardCount += outerCards.length + innerCards.length + pieceCards.length;

    if (outerCards.length > 0) {
      tierSections.push(
        `<h3 class="tier-h">Outer · ${outerCards.length}</h3><div class="grid">${outerCards
          .map((card) =>
            renderCard({
              tierLabel: 'Outer carton',
              lineBusyCode: ln.lineBusyCode,
              skuDescription: ln.skuDescription,
              poRef: opts.poRef,
              card,
            }),
          )
          .join('')}</div>`,
      );
    }
    if (innerCards.length > 0) {
      tierSections.push(
        `<h3 class="tier-h">Inner · ${innerCards.length}</h3><div class="grid">${innerCards
          .map((card) =>
            renderCard({
              tierLabel: 'Inner pack',
              lineBusyCode: ln.lineBusyCode,
              skuDescription: ln.skuDescription,
              poRef: opts.poRef,
              card,
            }),
          )
          .join('')}</div>`,
      );
    }
    if (pieceCards.length > 0) {
      tierSections.push(
        `<h3 class="tier-h">Piece · ${pieceCards.length}</h3><div class="grid">${pieceCards
          .map((card) =>
            renderPieceCard({
              lineBusyCode: ln.lineBusyCode,
              skuDescription: ln.skuDescription,
              lotNo: ln.lotNo,
              poRef: opts.poRef,
              card,
            }),
          )
          .join('')}</div>`,
      );
    }

    if (tierSections.length > 0) {
      lineSections.push(
        `<section class="sku-section"><h2 class="section-h">${escapeHtml(String(ln.lineBusyCode))} · ${escapeHtml(
          ln.skuDescription.slice(0, 80),
        )} · Lot ${escapeHtml(ln.lotNo)}</h2>${tierSections.join('')}</section>`,
      );
    }
  }

  if (lineSections.length === 0) {
    return { opened: false, cardCount: 0 };
  }

  const w = window.open('', '_blank');
  if (!w) {
    return { opened: false, cardCount };
  }

  const head = opts.jobPublicId ? escapeHtml(opts.jobPublicId) : 'Receiving';
  const env = opts.envelopeCode ? ` · ${escapeHtml(opts.envelopeCode)}` : '';
  const phase = escapeHtml(opts.phaseLabel);
  const extraStyles = `
  .section-h { font-size: 13px; margin: 14px 0 6px; font-weight: 800; color: #0f172a; border-top: 1px dashed #cbd5e1; padding-top: 8px; }
  .section-h:first-of-type { border-top: 0; margin-top: 0; padding-top: 0; }
  .tier-h { font-size: 11px; margin: 8px 0 4px; font-weight: 800; color: #0369a1; }
  .sku-section { page-break-inside: auto; }
  `;

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.documentTitle)}</title>
    <style>${PRINT_STYLES}${extraStyles}</style>
  </head><body>
    <h1>${head}${env} · ${phase}</h1>
    <div class="meta">Scan <strong>Pack</strong> or <strong>Item</strong> QR on each sticker</div>
    ${lineSections.join('')}
    <script>window.onload=function(){window.print();}</script>
  </body></html>`);
  w.document.close();
  return { opened: true, cardCount };
}

/** BIN / rack QR from Label Studio: JSON with rack + optional busy_code, or RACK:/BIN: prefix. */
export function parseReceivingBinScan(raw: string): { binId: string; skuBusyCode: number | null } {
  const trimmed = raw?.trim() ?? '';
  const fromRack = parseRackPayload(trimmed);
  const binId = fromRack?.rackCode
    ? fromRack.rackCode.trim().toUpperCase().replace(/\s+/g, '')
    : trimmed.toUpperCase().replace(/\s+/g, '');
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const rawBusy = parsed.busy_code ?? parsed.busyCode;
    if (typeof rawBusy === 'number' && Number.isFinite(rawBusy)) {
      return { binId, skuBusyCode: rawBusy };
    }
    if (typeof rawBusy === 'string' && rawBusy.trim()) {
      const n = Number(rawBusy.trim());
      if (Number.isFinite(n)) return { binId, skuBusyCode: n };
    }
  } catch {
    /* plain rack / raw */
  }
  return { binId, skuBusyCode: null };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
