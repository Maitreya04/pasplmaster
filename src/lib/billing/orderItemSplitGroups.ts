import type { OrderItem } from '../../types';

export type OrderItemDisplayGroup = {
  key: string;
  root: OrderItem;
  siblings: OrderItem[];
};

/** Group MRP-split siblings under their root line for billing display. */
export function groupOrderItemsForDisplay(items: OrderItem[]): OrderItemDisplayGroup[] {
  const splitChildren = new Map<number, OrderItem[]>();
  const roots: OrderItem[] = [];

  for (const item of items) {
    if (item.split_from_id != null) {
      const list = splitChildren.get(item.split_from_id) ?? [];
      list.push(item);
      splitChildren.set(item.split_from_id, list);
    } else {
      roots.push(item);
    }
  }

  return roots.map((root) => ({
    key: String(root.id),
    root,
    siblings: splitChildren.get(root.id) ?? [],
  }));
}

export function orderItemConfirmedMrp(item: OrderItem): number | null {
  const fromColumn = item.confirmed_mrp;
  if (fromColumn != null && Number.isFinite(Number(fromColumn))) {
    return Number(fromColumn);
  }
  const fromScan = item.scan_result?.confirmedMrp;
  if (fromScan != null && Number.isFinite(Number(fromScan))) {
    return Number(fromScan);
  }
  return null;
}

export function orderItemSplitBatchCount(siblings: OrderItem[]): number {
  return 1 + siblings.length;
}
