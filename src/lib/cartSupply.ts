import type { Item } from '../types';
import { getStockTier } from './stockDisplay';

/**
 * Max units this line can ship from on-hand stock.
 * Legacy helper for callers that intentionally use the catalog's global stock.
 * Sales checkout should pass a location-wise available quantity instead.
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
  cartQty: number,
  stockQty: number | null | undefined,
): { ship: number; po: number } {
  const ship = qtyShippableFromStockQty(stockQty, cartQty);
  return { ship, po: Math.max(0, cartQty - ship) };
}

/** Paid + FOC pieces on one cart row. */
export function cartLineTotalPieces(ci: { qty: number; focQty?: number | null }): number {
  const foc = Math.max(0, Math.floor(ci.focQty ?? 0));
  return Math.max(0, ci.qty) + foc;
}

/** Allocate shipped units: paid first, then FOC (same convention as checkout submission order). */
export function splitShippedPaidFoc(
  paidQty: number,
  _focQty: number,
  shipTotal: number,
): { shippedPaid: number; shippedFoc: number } {
  const p = Math.max(0, paidQty);
  const ship = Math.max(0, shipTotal);
  const shippedPaid = Math.min(p, ship);
  const shippedFoc = ship - shippedPaid;
  return { shippedPaid, shippedFoc };
}

/** Stock split for a cart line with optional FOC qty (same SKU). */
export function splitCartLinePaidFoc(
  paidQty: number,
  focQty: number,
  stockQty: number | null | undefined,
): {
  ship: number;
  po: number;
  shippedPaid: number;
  shippedFoc: number;
  poPaid: number;
  poFoc: number;
} {
  const p = Math.max(0, paidQty);
  const f = Math.max(0, focQty);
  const total = p + f;
  const { ship, po } = splitCartLine(total, stockQty);
  const { shippedPaid, shippedFoc } = splitShippedPaidFoc(p, f, ship);
  const poPaid = Math.max(0, p - shippedPaid);
  const poFoc = Math.max(0, f - shippedFoc);
  return { ship, po, shippedPaid, shippedFoc, poPaid, poFoc };
}

/** PO gap = total requested minus what ships from stock. */
export function poQtyForLine(item: Item, cartQty: number): number {
  return splitCartLine(cartQty, item.stock_qty).po;
}

/** Does this line have a PO gap? */
export function hasPo(item: Item, cartQty: number): boolean {
  return splitCartLine(cartQty, item.stock_qty).po > 0;
}

/** Is this line fully PO (nothing from stock)? */
export function isFullyPo(item: Item, cartQty: number): boolean {
  return cartQty > 0 && splitCartLine(cartQty, item.stock_qty).ship === 0;
}

export type PickLineQty = {
  qty_requested: number;
  qty_shippable?: number | null;
  qty_po?: number | null;
  qty_approved?: number | null;
};

/** Max units this line can ship from on-hand stock (not PO backlog). */
export function shippableCapForPick(oi: PickLineQty): number {
  if (oi.qty_shippable != null && Number.isFinite(oi.qty_shippable)) {
    return Math.max(0, Math.floor(oi.qty_shippable));
  }
  const requested = Math.max(0, Math.floor(oi.qty_requested ?? 0));
  if (oi.qty_po != null && Number.isFinite(oi.qty_po)) {
    return Math.max(0, requested - Math.max(0, Math.floor(oi.qty_po)));
  }
  return requested;
}

/** Quantity picker should physically pick (cap by shippable, then approval). */
export function pickQuantityTarget(oi: PickLineQty): number {
  const shipCap = shippableCapForPick(oi);
  if (oi.qty_approved != null && Number.isFinite(oi.qty_approved)) {
    return Math.min(Math.max(0, Math.floor(oi.qty_approved)), shipCap);
  }
  return shipCap;
}

/** True when billing approved at least one unit to pick from stock. */
export function isPickableOrderLine(oi: PickLineQty): boolean {
  return pickQuantityTarget(oi) > 0;
}

type PickLineWithSplit = PickLineQty & { split_from_id?: number | null };

/** Exclude MRP-split sibling rows — they are created already-picked during split flow. */
export function pickableOrderItems<T extends PickLineWithSplit>(items: T[]): T[] {
  return items.filter(isPickableOrderLine).filter((i) => i.split_from_id == null);
}

export function countPickableOrderLines(items: PickLineQty[]): number {
  return pickableOrderItems(items).length;
}

export type PickLineProgress = {
  total: number;
  picked: number;
  flagged: number;
  done: number;
  remaining: number;
};

/** Pick progress counts only shippable warehouse lines (excludes PO-only). */
export function computePickLineProgress(
  items: Array<PickLineQty & { state?: string | null }>,
): PickLineProgress {
  const pickLines = pickableOrderItems(items);
  const total = pickLines.length;
  let picked = 0;
  let flagged = 0;
  for (const item of pickLines) {
    if (item.state === 'picked' || item.state === 'overridden') picked += 1;
    else if (item.state === 'flagged') flagged += 1;
  }
  const done = picked + flagged;
  return { total, picked, flagged, done, remaining: Math.max(0, total - done) };
}

/**
 * Warehouse pick skips PO-only lines — mark them picked at billing approve so they
 * never appear in the pick queue or progress denominators.
 */
export function applyWarehousePickSkipForPoOnlyLine(
  update: Record<string, unknown>,
  line: PickLineQty,
  opts: {
    fulfillmentPath?: string | null;
    currentState?: string | null;
    skip?: boolean;
  },
): void {
  if (opts.skip) return;
  if (opts.fulfillmentPath !== 'warehouse_pick') return;
  if (opts.currentState === 'flagged') return;
  const target = pickQuantityTarget({
    qty_requested: line.qty_requested,
    qty_approved: update.qty_approved as number | undefined,
    qty_shippable: update.qty_shippable as number | undefined,
    qty_po: update.qty_po as number | undefined,
  });
  if (target === 0) {
    update.state = 'picked';
  }
}
