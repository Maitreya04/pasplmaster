import { pickQuantityTarget, type PickLineQty } from '../cartSupply';
import { deskLineFlagKind } from './deskLineFlagKind';
import type { OrderItem, PendingItem } from '../../types';

function nonPickerPendingQty(rows: PendingItem[]): number {
  return rows
    .filter((row) => row.status === 'pending' && row.source !== 'picking')
    .reduce((sum, row) => sum + Math.max(0, row.qty_pending), 0);
}

/**
 * True when a flagged desk line is already covered by PO / pending demand and
 * should not appear in the billing desk flag modal (especially Out of Stock).
 *
 * Picker-created pending rows (source=picking) are excluded from PO coverage
 * because billing still confirms price and removal for fresh OOS flags.
 */
export function isDeskFlagLineAlreadyOnPo(
  item: PickLineQty & Pick<OrderItem, 'item_id' | 'flag_reason'>,
  pendingRowsForItem: PendingItem[],
): boolean {
  if (pickQuantityTarget(item) === 0) return true;

  if (deskLineFlagKind(item.flag_reason) !== 'oos') return false;

  const poQty = Math.max(item.qty_po ?? 0, nonPickerPendingQty(pendingRowsForItem));
  return poQty >= item.qty_requested;
}

export function indexPendingItemsByItemId(
  pendingItems: PendingItem[],
): Map<number, PendingItem[]> {
  const map = new Map<number, PendingItem[]>();
  for (const row of pendingItems) {
    if (row.item_id == null) continue;
    const list = map.get(row.item_id) ?? [];
    list.push(row);
    map.set(row.item_id, list);
  }
  return map;
}
