import { billLineIdentity } from './billLineIdentity';
import { billLinePosition } from './sortBillLines';
import {
  billableQtyForTotal,
  deriveBillLineFulfillment,
  type BillLineFulfillment,
} from './billLineFulfillment';
import { deskLineFlagKind } from './deskLineFlagKind';
import {
  pickMrpGroupForItem,
  pickMrpQtyBreakdownForItem,
} from './pickMrpBillingContext';
import type { OrderItem, PendingItem } from '../../types';
import type { OverlayLineEdit } from '../../pages/billing/BillingDesk/types';

export type ReviewTableGroupId = 'flagged' | 'bill' | 'skip';

/** Consecutive bill rows for the same part (MRP split or duplicate Busy lines). */
export type ReviewPartGroupMeta = {
  rootId: number;
  size: number;
  index: number;
  orderedQty: number;
  /** e.g. "1 pcs @ ₹181 · 1 pcs @ ₹150" */
  breakdown: string | null;
  isFirst: boolean;
  isContinuation: boolean;
};

export type ReviewTableRow = {
  item: OrderItem;
  edit: OverlayLineEdit;
  lineNo: number;
  fulfillment: BillLineFulfillment;
  pendingRows: PendingItem[];
  lineTotal: number;
  quotedPrice: number;
  samePartAsPrevious: boolean;
  partGroup: ReviewPartGroupMeta | null;
};

export type ReviewTableGroup = {
  id: ReviewTableGroupId;
  title: string;
  hint: string;
  rows: ReviewTableRow[];
  subtotal: number;
  lineCount: number;
};

function rowTotal(item: OrderItem, edit: OverlayLineEdit, fulfillment: BillLineFulfillment): number {
  const price = edit.priceQuoted ?? item.price_quoted ?? item.price_system ?? 0;
  return price * billableQtyForTotal(item, fulfillment);
}

function buildRow(
  item: OrderItem,
  edit: OverlayLineEdit,
  sortedLines: OrderItem[],
  pendingByItemId: Map<number, PendingItem[]>,
): ReviewTableRow {
  const pendingRows = item.item_id != null ? pendingByItemId.get(item.item_id) ?? [] : [];
  const fulfillment = deriveBillLineFulfillment(item, pendingRows);
  return {
    item,
    edit,
    lineNo: billLinePosition(item, sortedLines),
    fulfillment,
    pendingRows,
    lineTotal: rowTotal(item, edit, fulfillment),
    quotedPrice: item.price_quoted ?? item.price_system ?? 0,
    samePartAsPrevious: false,
    partGroup: null,
  };
}

function rowsSharePartGroup(a: OrderItem, b: OrderItem): boolean {
  if (a.item_id != null && a.item_id === b.item_id) return true;
  const rootA = a.split_from_id ?? a.id;
  const rootB = b.split_from_id ?? b.id;
  return rootA === rootB;
}

function partGroupOrderedQty(rows: ReviewTableRow[], sortedLines: OrderItem[]): number {
  const first = rows[0]!.item;
  const { root, siblings } = pickMrpGroupForItem(first, sortedLines);
  const fromSplit =
    (root.qty_requested ?? 0) + siblings.reduce((sum, line) => sum + (line.qty_requested ?? 0), 0);
  if (fromSplit > 0) return fromSplit;
  return rows.reduce((sum, row) => sum + (row.item.qty_requested ?? 0), 0);
}

function partGroupBreakdown(rows: ReviewTableRow[], sortedLines: OrderItem[]): string | null {
  const mix = pickMrpQtyBreakdownForItem(rows[0]!.item, sortedLines);
  if (mix) return mix;
  if (rows.length <= 1) return null;
  const billQty = rows.reduce(
    (sum, row) => sum + billableQtyForTotal(row.item, row.fulfillment),
    0,
  );
  return `${rows.length} Busy lines · ${billQty} pcs billing today`;
}

function markPartGroups(rows: ReviewTableRow[], sortedLines: OrderItem[]): void {
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && rowsSharePartGroup(rows[i]!.item, rows[j]!.item)) {
      j += 1;
    }
    const size = j - i;
    if (size > 1) {
      const slice = rows.slice(i, j);
      const orderedQty = partGroupOrderedQty(slice, sortedLines);
      const breakdown = partGroupBreakdown(slice, sortedLines);
      const rootId = rows[i]!.item.split_from_id ?? rows[i]!.item.id;
      for (let k = i; k < j; k += 1) {
        rows[k]!.partGroup = {
          rootId,
          size,
          index: k - i,
          orderedQty,
          breakdown,
          isFirst: k === i,
          isContinuation: k > i,
        };
        rows[k]!.samePartAsPrevious = k > i;
      }
    }
    i = j;
  }
}

export function buildReviewBillTableGroups(
  displayLines: OrderItem[],
  sortedLines: OrderItem[],
  edits: Record<number, OverlayLineEdit>,
  pendingByItemId: Map<number, PendingItem[]>,
  flaggedItemIds: Set<number>,
): ReviewTableGroup[] {
  const flagged: ReviewTableRow[] = [];
  const bill: ReviewTableRow[] = [];
  const skip: ReviewTableRow[] = [];

  for (const item of displayLines) {
    const edit = edits[item.id];
    if (!edit || (edit.removed && item.state !== 'flagged')) continue;

    const row = buildRow(item, edit, sortedLines, pendingByItemId);

    const isUnresolvedFlag =
      item.state === 'flagged' &&
      flaggedItemIds.has(item.id) &&
      edit.resolution == null &&
      !edit.removed;

    if (isUnresolvedFlag) {
      flagged.push(row);
      continue;
    }

    if (item.state === 'flagged' && edit.resolution == null && !edit.removed) {
      continue;
    }

    if (row.fulfillment.excludeFromBusyBill) {
      skip.push(row);
    } else {
      bill.push(row);
    }
  }

  flagged.sort((a, b) => a.lineNo - b.lineNo);
  bill.sort((a, b) => a.lineNo - b.lineNo);
  skip.sort((a, b) => a.lineNo - b.lineNo);
  markPartGroups(bill, sortedLines);

  const groups: ReviewTableGroup[] = [];

  if (flagged.length > 0) {
    groups.push({
      id: 'flagged',
      title: 'Resolve before billing',
      hint: 'Picker flagged these — choose an action on each row',
      rows: flagged,
      subtotal: 0,
      lineCount: flagged.length,
    });
  }

  groups.push({
    id: 'bill',
    title: 'Being billed',
    hint: 'Copy line order + resolved rate into Busy — rate × qty = line total',
    rows: bill,
    subtotal: bill.reduce((s, r) => s + r.lineTotal, 0),
    lineCount: bill.filter((r) => r.fulfillment.qtyBillToday > 0).length,
  });

  if (skip.length > 0) {
    groups.push({
      id: 'skip',
      title: 'Pending order',
      hint: 'Out of stock · will fulfil separately — skip in Busy today',
      rows: skip,
      subtotal: 0,
      lineCount: skip.length,
    });
  }

  return groups;
}

/** Airtable-style status label + long description for Notes column. */
export function reviewStatusLabel(
  row: ReviewTableRow,
): { short: string; long: string } {
  const { fulfillment, item } = row;
  const flagKind = deskLineFlagKind(item.flag_reason);

  if (flagKind === 'price' && item.state === 'flagged') {
    return { short: 'Price fix', long: item.flag_reason ?? 'Price mismatch' };
  }
  if (flagKind === 'oos' && item.state === 'flagged') {
    return { short: 'Picker OOS', long: fulfillment.summary };
  }

  if (item.scan_result?.isOverTarget) {
    const original = item.scan_result.originalTargetQty ?? item.scan_result.progress?.targetQty;
    const picked = item.scan_result.progress?.pickedQty ?? item.qty_requested;
    const extra =
      item.scan_result.overTargetQty ??
      (original != null ? Math.max(0, picked - original) : null);
    const note = item.scan_result.pickerNote?.trim();
    return {
      short: 'Overpick',
      long: `Picked ${picked}${original != null ? ` vs ${original} ordered` : ''}${
        extra != null && extra > 0 ? ` · ${extra} extra` : ''
      }${note ? ` · ${note}` : ''}`,
    };
  }

  if (item.scan_result?.isShortPick) {
    const original = item.scan_result.originalTargetQty ?? item.scan_result.progress?.targetQty;
    const picked = item.scan_result.progress?.pickedQty ?? item.qty_requested;
    const short = item.scan_result.shortQty;
    const reason = item.scan_result.shortReason?.trim();
    const note = item.scan_result.pickerNote?.trim();
    return {
      short: 'Short pick',
      long: `Picked ${picked}${original != null ? ` of ${original}` : ''}${
        short != null && short > 0 ? ` · ${short} short` : ''
      }${reason ? ` · ${reason}` : ''}${note ? ` · ${note}` : ''}`,
    };
  }

  switch (fulfillment.role) {
    case 'foc':
      return { short: 'FOC', long: 'Free qty from sales — bill at ₹0, still ships' };
    case 'sales_po':
      return { short: 'Sales PO', long: fulfillment.summary };
    case 'picker_oos':
      return { short: 'Picker OOS', long: fulfillment.summary };
    case 'billing_oos':
      return { short: 'Billing OOS', long: fulfillment.summary };
    case 'mixed':
      return {
        short: fulfillment.chipLabel.includes('PO') ? 'Partial PO' : 'Partial OOS',
        long: fulfillment.summary,
      };
    default:
      return {
        short: fulfillment.isMrpSplit ? 'Bill · batch' : 'Bill',
        long: fulfillment.summary,
      };
  }
}

export function reviewProductLabel(row: ReviewTableRow): {
  name: string;
  pickCode: string;
  altCode: string | null;
} {
  const identity = billLineIdentity(row.item);
  return {
    name: identity.description,
    pickCode: identity.pickCode,
    altCode: identity.altCode,
  };
}
