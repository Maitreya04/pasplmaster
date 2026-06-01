import { billLineIdentity } from './billLineIdentity';
import { billLinePosition } from './sortBillLines';
import {
  billableQtyForTotal,
  deriveBillLineFulfillment,
  type BillLineFulfillment,
} from './billLineFulfillment';
import { deskLineFlagKind } from './deskLineFlagKind';
import type { OrderItem, PendingItem } from '../../types';
import type { OverlayLineEdit } from '../../pages/billing/BillingDesk/types';

export type ReviewTableGroupId = 'flagged' | 'bill' | 'skip';

export type ReviewTableRow = {
  item: OrderItem;
  edit: OverlayLineEdit;
  lineNo: number;
  fulfillment: BillLineFulfillment;
  pendingRows: PendingItem[];
  lineTotal: number;
  quotedPrice: number;
  samePartAsPrevious: boolean;
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
  };
}

function markSamePartRuns(rows: ReviewTableRow[]): void {
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1]!;
    const curr = rows[i]!;
    if (
      prev.item.item_id != null &&
      curr.item.item_id === prev.item.item_id &&
      !curr.fulfillment.excludeFromBusyBill &&
      !prev.fulfillment.excludeFromBusyBill
    ) {
      curr.samePartAsPrevious = true;
    }
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
  markSamePartRuns(bill);

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
    hint: 'Copy line order into Busy — rate × qty = line total',
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
