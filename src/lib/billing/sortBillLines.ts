import { busyBillableQty } from './busyLineSplit';
import type { BillingLiveQueueFlag } from './liveQueueDraft';
import { busyPasteUnitLabel, effectiveSalesLineUnit } from '../salesUnit';
import { orderItemDisplayName } from '../../utils/formatters';
import type { OrderItem, SalesLineUnit } from '../../types';

export type BusyPasteLineEditPatch = {
  qtyRequested?: number;
  removed?: boolean;
  salesUnit?: SalesLineUnit;
};

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
  lineEdits?: Record<number, BusyPasteLineEditPatch>;
  flags?: Record<number, BillingLiveQueueFlag>;
}

/** Tab-separated lines for Busy paste: item name + qty + sales-selected unit in `bill_line_no` order. */
export function buildBusyPasteText(
  items: OrderItem[],
  opts?: BuildBusyPasteTextOptions,
): string {
  const lineEdits = opts?.lineEdits;
  const flags = opts?.flags;
  const rows = sortBillLines(items).filter((item) => !lineEdits?.[item.id]?.removed);

  return rows
    .map((item) => {
      const edit = lineEdits?.[item.id];
      const flag = flags?.[item.id];
      const qty = flags
        ? busyBillableQty(item, flag, edit)
        : edit?.qtyRequested ?? item.qty_requested;
      if (qty <= 0) return null;
      const unitLabel = busyPasteUnitLabel(effectiveSalesLineUnit(item, edit));
      return unitLabel
        ? `${orderItemDisplayName(item)}\t${qty}\t${unitLabel}`
        : `${orderItemDisplayName(item)}\t${qty}`;
    })
    .filter((line): line is string => line != null)
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
