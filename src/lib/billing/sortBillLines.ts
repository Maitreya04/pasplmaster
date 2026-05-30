import type { OrderItem } from '../../types';

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
