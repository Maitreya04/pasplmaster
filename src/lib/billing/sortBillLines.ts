import type { BillingLineEdit } from './liveQueueDraft';
import type { OrderItem } from '../../types';
import { getQuotedPrice } from '../specialPricing';
import { orderItemDisplayName } from '../../utils/formatters';

/** Stable bill sequence: `bill_line_no` when present, else legacy `id` order. */
export function billLineSortKey(item: OrderItem): number {
  return item.bill_line_no ?? item.id;
}

export function sortBillLines<T extends OrderItem>(items: T[]): T[] {
  return [...items].sort((a, b) => billLineSortKey(a) - billLineSortKey(b));
}

export function billLinePosition(item: OrderItem, sortedItems: OrderItem[]): number {
  const idx = sortedItems.findIndex((row) => row.id === item.id);
  return idx >= 0 ? idx + 1 : item.bill_line_no ?? 0;
}

export interface BuildBusyPasteTextOptions {
  lineEdits?: Record<number, BillingLineEdit>;
  includeRate?: boolean;
}

function busyPasteRate(item: OrderItem, edit?: BillingLineEdit): number | null {
  if (typeof edit?.priceQuoted === 'number' && Number.isFinite(edit.priceQuoted)) {
    return edit.priceQuoted;
  }
  return getQuotedPrice(item);
}

/** Tab-separated lines for Busy paste: name + qty (+ rate when requested) in `bill_line_no` order. */
export function buildBusyPasteText(
  items: OrderItem[],
  opts?: BuildBusyPasteTextOptions,
): string {
  const lineEdits = opts?.lineEdits;
  const rows = sortBillLines(items).filter((item) => !lineEdits?.[item.id]?.removed);

  return rows
    .map((item) => {
      const edit = lineEdits?.[item.id];
      const qty = edit?.qtyRequested ?? item.qty_requested;
      if (!opts?.includeRate) return `${orderItemDisplayName(item)}\t${qty}`;
      const rate = busyPasteRate(item, edit);
      return `${orderItemDisplayName(item)}\t${qty}\t${rate ?? ''}`;
    })
    .join('\n');
}

/** Flag entries sorted by bill line sequence (for confirm modals and summaries). */
export function sortFlagsByBillLine<T>(
  flags: Record<number, T>,
  items: OrderItem[],
): Array<[number, T]> {
  const itemById = new Map(items.map((item) => [item.id, item]));

  return Object.entries(flags)
    .map(([idStr, flag]) => [Number(idStr), flag] as [number, T])
    .sort((a, b) => {
      const itemA = itemById.get(a[0]);
      const itemB = itemById.get(b[0]);
      const keyA = itemA != null ? billLineSortKey(itemA) : a[0];
      const keyB = itemB != null ? billLineSortKey(itemB) : b[0];
      return keyA - keyB;
    });
}
