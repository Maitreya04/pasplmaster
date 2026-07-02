import {
  billableQtyForTotal,
  deriveBillLineFulfillment,
} from './billLineFulfillment';
import {
  buildReviewBillTableGroups,
  reviewStatusLabel,
} from './reviewBillTableRows';
import { formatBusyPasteLine, sortBillLines } from './sortBillLines';
import { effectiveSalesLineUnit, salesLineUnitLabel } from '../salesUnit';
import type { OrderItem, PendingItem } from '../../types';
import type { OverlayLineEdit } from '../../pages/billing/BillingDesk/types';

export interface FinalBillCopyRow {
  item: OrderItem;
  edit: OverlayLineEdit;
  qty: number;
  unitLabel: string;
  rate: number;
  lineTotal: number;
  status: string;
  note: string;
}

export interface FinalBillCopyInput {
  sortedLines: OrderItem[];
  edits: Record<number, OverlayLineEdit>;
  pendingByItemId: Map<number, PendingItem[]>;
  flaggedItems: OrderItem[];
}

export function buildFinalBillCopyRows({
  sortedLines,
  edits,
  pendingByItemId,
  flaggedItems,
}: FinalBillCopyInput): FinalBillCopyRow[] {
  const orderedLines = sortBillLines(sortedLines);
  const flaggedItemIds = new Set(flaggedItems.map((item) => item.id));
  const displayLines = orderedLines.filter(
    (item) =>
      item.state !== 'flagged' ||
      flaggedItemIds.has(item.id) ||
      edits[item.id]?.removed,
  );
  const groups = buildReviewBillTableGroups(
    displayLines,
    orderedLines,
    edits,
    pendingByItemId,
    flaggedItemIds,
  );
  const billRows = groups.find((group) => group.id === 'bill')?.rows ?? [];

  return billRows
    .filter((row) => {
      if (row.edit.removed) return false;
      if (row.fulfillment.excludeFromBusyBill) return false;
      return billableQtyForTotal(row.item, row.fulfillment) > 0;
    })
    .map((row) => {
      const qty = billableQtyForTotal(row.item, row.fulfillment);
      const rate = row.fulfillment.role === 'foc' ? 0 : row.edit.priceQuoted;
      const status = reviewStatusLabel(row);
      return {
        item: row.item,
        edit: row.edit,
        qty,
        unitLabel: salesLineUnitLabel(effectiveSalesLineUnit(row.item, row.edit)),
        rate,
        lineTotal: rate * qty,
        status: status.short,
        note: status.long,
      };
    });
}

/** Final bill paste adds resolved bill rate (label MRP, special rate, manual override). */
export function formatFinalBillPasteLine(row: FinalBillCopyRow): string | null {
  const base = formatBusyPasteLine(row.item, row.qty, row.edit);
  if (base == null) return null;
  return `${base}\t${Math.round(row.rate)}`;
}

/** Tab-separated lines for Busy paste at finalise: name + qty + unit + resolved rate. */
export function buildFinalBillPasteText(rows: FinalBillCopyRow[]): string {
  return rows
    .map((row) => formatFinalBillPasteLine(row))
    .filter((line): line is string => line != null)
    .join('\n');
}

export function finalBillCopyTotals(rows: FinalBillCopyRow[]): {
  lineCount: number;
  qtyTotal: number;
  valueTotal: number;
} {
  return rows.reduce(
    (acc, row) => ({
      lineCount: acc.lineCount + 1,
      qtyTotal: acc.qtyTotal + row.qty,
      valueTotal: acc.valueTotal + row.lineTotal,
    }),
    { lineCount: 0, qtyTotal: 0, valueTotal: 0 },
  );
}

export function countFinalBillPendingRows({
  sortedLines,
  edits,
  pendingByItemId,
}: Pick<FinalBillCopyInput, 'sortedLines' | 'edits' | 'pendingByItemId'>): number {
  return sortedLines.filter((item) => {
    if (edits[item.id]?.removed) return false;
    const pending = item.item_id != null ? pendingByItemId.get(item.item_id) ?? [] : [];
    const fulfillment = deriveBillLineFulfillment(item, pending);
    return fulfillment.excludeFromBusyBill || fulfillment.qtySalesPo > 0 || fulfillment.qtyPickerOos > 0;
  }).length;
}
