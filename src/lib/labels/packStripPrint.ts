import QRCode from 'qrcode';
import { packPickPayload } from '../receiving/receivingPrintUtils';
import { itemPickCode, itemAlternateCode } from '../../utils/itemCodes';
import type { Item } from '../../types';

export interface ReceivingPrintPlate {
  lpn_code: string;
  pack_type: string;
  pack_qty: number;
  receiving_lot: string | null;
  receiving_pack_seq?: number | null;
}

export interface ReceivingUnifiedLabelCard {
  plate: ReceivingPrintPlate;
  packQrSvg: string;
  itemQrSvg: string;
  packPayload: string;
  itemPayload: string;
  aliasHeading: string;
  aliasFootnote?: string;
  indexOfTotal: string;
}

/** ITEM QR payload — never empty (qrcode throws on empty input). */
export function receivingItemPickPayload(
  item: Pick<Item, 'alias1' | 'alias'> | null,
  busyCode: number,
): string {
  const fromItem = item ? itemPickCode(item).trim() : '';
  return fromItem || String(busyCode);
}

export function aliasDisplayForItem(item: Pick<Item, 'alias1' | 'alias'>): {
  heading: string;
  footnote?: string;
} {
  const a1 = item.alias1?.trim() ?? '';
  const alias = item.alias?.trim() ?? '';
  if (a1) {
    return {
      heading: a1,
      footnote: alias && alias !== a1 ? `Busy ${alias}` : undefined,
    };
  }
  if (alias) return { heading: alias };
  return { heading: 'Scan code' };
}

export async function buildUnifiedReceivingLabelCards(args: {
  plates: ReceivingPrintPlate[];
  packType: 'inner' | 'outer';
  busyCode: number;
  item: Pick<Item, 'alias1' | 'alias'> | null;
}): Promise<ReceivingUnifiedLabelCard[]> {
  const filtered = args.plates.filter((p) => p.pack_type === args.packType);
  const total = filtered.length;
  const pick = receivingItemPickPayload(args.item, args.busyCode);
  const alt = args.item ? itemAlternateCode(args.item) : null;
  const alias = args.item ? aliasDisplayForItem(args.item) : { heading: pick };
  const packPayload = packPickPayload(args.busyCode, args.packType);

  const [packQrSvg, itemQrSvg] = await Promise.all([
    QRCode.toString(packPayload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
    QRCode.toString(pick, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
  ]);

  return filtered.map((plate, i) => ({
    plate,
    packQrSvg,
    itemQrSvg,
    packPayload,
    itemPayload: pick,
    aliasHeading: alias.heading,
    aliasFootnote: alias.footnote ?? (alt ? `Busy ${alt}` : undefined),
    indexOfTotal: total > 0 ? `${i + 1} of ${total}` : '',
  }));
}

export interface ReceivingPieceLabelCard {
  itemQrSvg: string;
  aliasHeading: string;
  aliasFootnote?: string;
  indexOfTotal: string;
}

/** Identical piece (ITEM QR) stickers for bulk receiving print. */
export async function buildPieceReceivingLabelCards(args: {
  count: number;
  busyCode: number;
  lotNo: string;
  item: Pick<Item, 'alias1' | 'alias'> | null;
}): Promise<ReceivingPieceLabelCard[]> {
  const n = Math.max(0, Math.min(500, Math.floor(args.count)));
  if (n <= 0) return [];
  const pick = receivingItemPickPayload(args.item, args.busyCode);
  const alias = args.item ? aliasDisplayForItem(args.item) : { heading: pick };
  const itemQrSvg = await QRCode.toString(pick, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return Array.from({ length: n }, (_, i) => ({
    itemQrSvg,
    aliasHeading: alias.heading,
    aliasFootnote: alias.footnote,
    indexOfTotal: `${i + 1} of ${n}`,
  }));
}
