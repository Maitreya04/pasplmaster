/** Default “low stock” band when no per-item reorder level exists in DB yet. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 20;

export type StockTier = 'ok' | 'low' | 'out' | 'unknown';

export function formatStockQty(q: number): string {
  if (!Number.isFinite(q)) return '—';
  const rounded = Math.round(q * 100) / 100;
  if (Number.isInteger(rounded)) return rounded.toLocaleString('en-IN');
  return rounded.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function getStockTier(
  stockQty: number | null | undefined,
  lowThreshold: number = DEFAULT_LOW_STOCK_THRESHOLD,
): StockTier {
  if (stockQty == null || !Number.isFinite(Number(stockQty))) return 'unknown';
  const q = Number(stockQty);
  if (q <= 0) return 'out';
  if (q < lowThreshold) return 'low';
  return 'ok';
}

export function stockPrimaryLabel(stockQty: number | null | undefined, tier: StockTier): string {
  if (tier === 'unknown') return 'Stock unavailable';
  if (tier === 'out') return 'Out of stock';
  return `${formatStockQty(Number(stockQty))} in stock`;
}

export type StockSecondaryTone = 'muted' | 'negative';

/** Inline layout: single muted line vs shortfall callout + hint. */
export type StockAfterOrderVariant = 'line' | 'shortfall';

export type StockAfterOrderLineResult = {
  text: string;
  tone: StockSecondaryTone;
  variant: StockAfterOrderVariant;
  /** Extra guidance (e.g. PO / reduce qty) for `shortfall`. */
  hint?: string;
};

/**
 * Context lines when this item already has quantity on the cart.
 *
 * Edge cases:
 * - Remaining positive: how much stays on hand after the cart (restock signal).
 * - Remaining zero: avoid saying “0 left”; frame as all on-hand units are on this cart.
 * - Remaining negative: cart exceeds inventory — partial fulfillment; suggest PO or reducing qty.
 */
export function stockAfterOrderLine(
  stockQty: number,
  totalInOrderQty: number,
  tier: StockTier,
): StockAfterOrderLineResult | null {
  if (tier === 'unknown' || tier === 'out') return null;
  if (totalInOrderQty <= 0) return null;
  const remaining = stockQty - totalInOrderQty;
  if (remaining > 0) {
    return {
      text: `${formatStockQty(remaining)} still on hand after this cart`,
      tone: 'muted',
      variant: 'line',
    };
  }
  if (remaining === 0) {
    return {
      text: 'This cart uses all units currently in stock.',
      tone: 'muted',
      variant: 'line',
    };
  }
  const overBy = -remaining;
  return {
    text: `Short by ${formatStockQty(overBy)}, request PO at checkout.`,
    tone: 'negative',
    variant: 'shortfall',
  };
}
