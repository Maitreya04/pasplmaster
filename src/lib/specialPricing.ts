import type { OrderItem } from '../types';

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function getQuotedPrice(item: Pick<OrderItem, 'price_quoted' | 'price_system'>): number | null {
  if (isFiniteNumber(item.price_quoted)) return item.price_quoted;
  if (isFiniteNumber(item.price_system)) return item.price_system;
  return null;
}

export function getBookPrice(item: Pick<OrderItem, 'price_system'>): number | null {
  return isFiniteNumber(item.price_system) ? item.price_system : null;
}

/** Explicit FOC rows or legacy heuristic (₹0 quoted vs positive system). */
export function isFocOrderItem(
  item: Pick<OrderItem, 'is_foc' | 'price_quoted' | 'price_system'>,
): boolean {
  if (item.is_foc === true) return true;
  return (
    isFiniteNumber(item.price_quoted) &&
    item.price_quoted === 0 &&
    isFiniteNumber(item.price_system) &&
    item.price_system > 0
  );
}

export function isSpecialRateItem(
  item: Pick<OrderItem, 'price_quoted' | 'price_system' | 'is_foc'>,
): boolean {
  if (isFocOrderItem(item)) return false;
  return isFiniteNumber(item.price_quoted) &&
    isFiniteNumber(item.price_system) &&
    item.price_quoted !== item.price_system;
}

export function summarizeSpecialPricing(
  items: Pick<OrderItem, 'price_quoted' | 'price_system' | 'qty_requested' | 'is_foc'>[],
): {
  specialLineCount: number;
  specialQty: number;
} {
  return items.reduce(
    (acc, item) => {
      if (!isSpecialRateItem(item)) return acc;
      acc.specialLineCount += 1;
      acc.specialQty += item.qty_requested;
      return acc;
    },
    { specialLineCount: 0, specialQty: 0 },
  );
}
