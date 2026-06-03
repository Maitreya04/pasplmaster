import { pickQuantityTarget, pickableOrderItems } from '../cartSupply';
import {
  billableQtyForTotal,
  deriveBillLineFulfillment,
  type BillLineFulfillment,
} from './billLineFulfillment';
import { billLineIdentity } from './billLineIdentity';
import { billLinePosition } from './sortBillLines';
import { deskLineFlagChipLabel, deskLineFlagKind } from './deskLineFlagKind';
import { busyEntryLineNature } from './busyEntryLineNature';
import type { OrderItem, PendingItem } from '../../types';

export type PickingTableGroupId = 'flagged' | 'awaiting' | 'picked' | 'skip';

export type PickingTableRow = {
  item: OrderItem;
  lineNo: number;
  fulfillment: BillLineFulfillment;
  lineTotal: number;
  quotedPrice: number;
  pickState: 'flagged' | 'awaiting' | 'picked' | 'skip';
};

export type PickingTableGroup = {
  id: PickingTableGroupId;
  title: string;
  hint: string;
  rows: PickingTableRow[];
  lineCount: number;
};

function rowTotal(item: OrderItem, fulfillment: BillLineFulfillment): number {
  const price = item.price_quoted ?? item.price_system ?? 0;
  return price * billableQtyForTotal(item, fulfillment);
}

function classifyPickState(
  item: OrderItem,
  fulfillment: BillLineFulfillment,
): PickingTableRow['pickState'] {
  if (fulfillment.excludeFromBusyBill || !pickableOrderItems([item]).length) {
    return 'skip';
  }
  if (item.state === 'flagged') return 'flagged';
  if (item.state === 'picked' || item.state === 'overridden') return 'picked';
  return 'awaiting';
}

export function buildPickingBillTableGroups(
  sortedLines: OrderItem[],
  pendingByItemId: Map<number, PendingItem[]>,
): PickingTableGroup[] {
  const flagged: PickingTableRow[] = [];
  const awaiting: PickingTableRow[] = [];
  const picked: PickingTableRow[] = [];
  const skip: PickingTableRow[] = [];

  for (const item of sortedLines) {
    const pendingRows =
      item.item_id != null ? pendingByItemId.get(item.item_id) ?? [] : [];
    const fulfillment = deriveBillLineFulfillment(item, pendingRows);
    const pickState = classifyPickState(item, fulfillment);
    const row: PickingTableRow = {
      item,
      lineNo: billLinePosition(item, sortedLines),
      fulfillment,
      lineTotal: rowTotal(item, fulfillment),
      quotedPrice: item.price_quoted ?? item.price_system ?? 0,
      pickState,
    };

    switch (pickState) {
      case 'flagged':
        flagged.push(row);
        break;
      case 'awaiting':
        awaiting.push(row);
        break;
      case 'picked':
        picked.push(row);
        break;
      default:
        skip.push(row);
        break;
    }
  }

  const sortByLine = (a: PickingTableRow, b: PickingTableRow) => a.lineNo - b.lineNo;
  flagged.sort(sortByLine);
  awaiting.sort(sortByLine);
  picked.sort(sortByLine);
  skip.sort(sortByLine);

  const groups: PickingTableGroup[] = [];

  if (flagged.length > 0) {
    groups.push({
      id: 'flagged',
      title: 'Picker flags',
      hint: 'These lines need billing attention when the pick finishes',
      rows: flagged,
      lineCount: flagged.length,
    });
  }

  if (awaiting.length > 0) {
    groups.push({
      id: 'awaiting',
      title: 'Awaiting pick',
      hint: 'Warehouse is scanning these lines now',
      rows: awaiting,
      lineCount: awaiting.length,
    });
  }

  if (picked.length > 0) {
    groups.push({
      id: 'picked',
      title: 'Picked',
      hint: 'Scanned in the warehouse — ready for billing when pick completes',
      rows: picked,
      lineCount: picked.length,
    });
  }

  if (skip.length > 0) {
    groups.push({
      id: 'skip',
      title: 'Not in today\'s pick',
      hint: 'Sales PO or pending stock — picker skips these',
      rows: skip,
      lineCount: skip.length,
    });
  }

  return groups;
}

export function pickingRowNotes(row: PickingTableRow): string {
  const { item, fulfillment } = row;

  if (row.pickState === 'awaiting') {
    const target = pickQuantityTarget(item);
    if (fulfillment.role === 'sales_po' || fulfillment.excludeFromBusyBill) {
      return fulfillment.summary;
    }
    return target > 0 ? `${target} pcs · not scanned yet` : 'Awaiting warehouse scan';
  }

  const parts: string[] = [];

  if (row.pickState === 'flagged' && item.flag_reason) {
    parts.push(deskLineFlagChipLabel(item.flag_reason));
    if (item.flag_notes?.trim()) parts.push(item.flag_notes.trim());
  } else {
    parts.push(fulfillment.summary);
  }

  const nature = busyEntryLineNature(item);
  if (nature === 'foc') parts.push('FOC');
  if (nature === 'special_rate') parts.push('Special rate');

  return parts.filter(Boolean).join(' · ');
}

export function pickingStatusLabel(row: PickingTableRow): { short: string; tone: string } {
  if (row.pickState === 'flagged') {
    const kind = deskLineFlagKind(row.item.flag_reason);
    if (kind === 'price') return { short: 'Flag · price', tone: 'flag' };
    if (kind === 'oos') return { short: 'Flag · OOS', tone: 'oos' };
    return { short: 'Flagged', tone: 'warn' };
  }
  if (row.pickState === 'picked') return { short: 'Picked', tone: 'bill' };
  if (row.pickState === 'awaiting') return { short: 'To pick', tone: 'accent' };
  return { short: 'Skip', tone: 'po' };
}

export function pickingProductLabel(row: PickingTableRow): {
  name: string;
  pickCode: string;
} {
  const identity = billLineIdentity(row.item);
  return {
    name: identity.description,
    pickCode: identity.pickCode,
  };
}
