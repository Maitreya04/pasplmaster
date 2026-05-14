import type { Item } from '../types';
import { getStockTier } from './stockDisplay';

/**
 * Max units this line can ship from on-hand stock.
 * OOS → 0. Unknown stock → full qty (no cap).
 */
export function qtyShippableFromStock(item: Item, cartQty: number): number {
  return qtyShippableFromStockQty(item.stock_qty, cartQty);
}

export function qtyShippableFromStockQty(
  stockQty: number | null | undefined,
  cartQty: number,
): number {
  const tier = getStockTier(stockQty);
  if (tier === 'out' || tier === 'unknown' || stockQty == null || !Number.isFinite(Number(stockQty))) {
    return 0;
  }
  const stock = Math.max(0, Number(stockQty));
  return Math.min(cartQty, stock);
}

/** One stock read: shippable vs PO gap (avoids double tier/qty work in UI loops). */
export function splitCartLine(
  item: Item,
  cartQty: number,
  stockQty: number | null | undefined = item.stock_qty,
): { ship: number; po: number } {
  const ship = qtyShippableFromStockQty(stockQty, cartQty);
  return { ship, po: Math.max(0, cartQty - ship) };
}

/** PO gap = total requested minus what ships from stock. */
export function poQtyForLine(item: Item, cartQty: number): number {
  return splitCartLine(item, cartQty).po;
}

/** Does this line have a PO gap? */
export function hasPo(item: Item, cartQty: number): boolean {
  return splitCartLine(item, cartQty).po > 0;
}

/** Is this line fully PO (nothing from stock)? */
export function isFullyPo(item: Item, cartQty: number): boolean {
  return cartQty > 0 && splitCartLine(item, cartQty).ship === 0;
}

/** Quantity picker should physically pick (cap by shippable, then approval). */
export function pickQuantityTarget(oi: {
  qty_requested: number;
  qty_shippable?: number;
  qty_approved?: number | null;
}): number {
  const shipCap = oi.qty_shippable ?? oi.qty_requested;
  if (oi.qty_approved != null && Number.isFinite(oi.qty_approved)) {
    return Math.min(oi.qty_approved, shipCap);
  }
  return shipCap;
}
