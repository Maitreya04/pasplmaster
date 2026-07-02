import {
  billableQtyForTotal,
  deriveBillLineFulfillment,
} from './billLineFulfillment';
import { orderItemConfirmedMrp } from './orderItemSplitGroups';
import {
  buildReviewBillTableGroups,
  reviewStatusLabel,
} from './reviewBillTableRows';
import { sortBillLines } from './sortBillLines';
import { busyPasteUnitLabel, effectiveSalesLineUnit, salesLineUnitLabel } from '../salesUnit';
import type { OrderItem, PendingItem } from '../../types';
import type { OverlayLineEdit } from '../../pages/billing/BillingDesk/types';

export type FinalBillCopyWarning =
  | 'missing_busy_code'
  | 'empty_item_name'
  | 'mrp_quoted_fallback';

export type BusyPasteMrpSource =
  | 'foc'
  | 'confirmed_mrp'
  | 'billing_accepted'
  | 'stock_at_pick'
  | 'quoted_fallback';

export interface FinalBillCopyRow {
  item: OrderItem;
  edit: OverlayLineEdit;
  qty: number;
  unitLabel: string;
  /** Resolved billing rate for totals display. */
  rate: number;
  pasteName: string;
  pasteMrp: number;
  mrpSource: BusyPasteMrpSource;
  warnings: FinalBillCopyWarning[];
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

/** Exact Busy item master string — frozen order snapshot, not display-stripped. */
export function busyPasteItemName(item: Pick<OrderItem, 'item_name'>): string {
  return item.item_name.trim();
}

function stockMrpFromScan(item: OrderItem): number | null {
  const raw = item.scan_result?.suggestedMrpAtPick ?? item.scan_result?.stockMrpAtPick;
  if (raw == null || !Number.isFinite(Number(raw))) return null;
  return Math.round(Number(raw));
}

/** MRP for Busy Item Price & Discount dialog (batch selection), not net discounted rate. */
export function resolveBusyPasteMrp(
  item: OrderItem,
  edit: OverlayLineEdit,
  isFoc: boolean,
): { mrp: number; source: BusyPasteMrpSource } {
  if (isFoc) return { mrp: 0, source: 'foc' };

  const confirmed = orderItemConfirmedMrp(item);
  if (confirmed != null) {
    return { mrp: Math.round(confirmed), source: 'confirmed_mrp' };
  }

  if (edit.resolution === 'accept_price' || edit.priceTouched) {
    return { mrp: Math.round(edit.priceQuoted), source: 'billing_accepted' };
  }

  const stockMrp = stockMrpFromScan(item);
  if (stockMrp != null) {
    return { mrp: stockMrp, source: 'stock_at_pick' };
  }

  return { mrp: Math.round(edit.priceQuoted), source: 'quoted_fallback' };
}

export function buildFinalBillCopyWarnings(
  item: OrderItem,
  mrpSource: BusyPasteMrpSource,
): FinalBillCopyWarning[] {
  const warnings: FinalBillCopyWarning[] = [];
  if (!busyPasteItemName(item)) warnings.push('empty_item_name');
  const busyCode = item.catalog_busy_code;
  if (busyCode == null || !Number.isFinite(Number(busyCode)) || Number(busyCode) <= 0) {
    warnings.push('missing_busy_code');
  }
  if (mrpSource === 'quoted_fallback') warnings.push('mrp_quoted_fallback');
  return warnings;
}

export function finalBillCopyWarningLabel(warning: FinalBillCopyWarning): string {
  switch (warning) {
    case 'missing_busy_code':
      return 'No Busy code on line';
    case 'empty_item_name':
      return 'Empty item name';
    case 'mrp_quoted_fallback':
      return 'MRP from quoted rate only';
  }
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
      const isFoc = row.fulfillment.role === 'foc';
      const rate = isFoc ? 0 : row.edit.priceQuoted;
      const { mrp, source } = resolveBusyPasteMrp(row.item, row.edit, isFoc);
      const status = reviewStatusLabel(row);
      return {
        item: row.item,
        edit: row.edit,
        qty,
        unitLabel: salesLineUnitLabel(effectiveSalesLineUnit(row.item, row.edit)),
        rate,
        pasteName: busyPasteItemName(row.item),
        pasteMrp: mrp,
        mrpSource: source,
        warnings: buildFinalBillCopyWarnings(row.item, source),
        lineTotal: rate * qty,
        status: status.short,
        note: status.long,
      };
    });
}

/** Final bill paste: item name + qty + unit + MRP for Busy finalise entry. */
export function formatFinalBillPasteLine(row: FinalBillCopyRow): string | null {
  if (row.qty <= 0) return null;
  const unitLabel = busyPasteUnitLabel(effectiveSalesLineUnit(row.item, row.edit));
  // Always preserve the unit column (blank for default pcs) so MRP lands in price.
  return `${row.pasteName}\t${row.qty}\t${unitLabel}\t${row.pasteMrp}`;
}

/** Tab-separated lines for Busy paste at finalise: name + qty + unit + MRP. */
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
