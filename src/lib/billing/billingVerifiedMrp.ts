import { supabase } from '../supabase/client';
import type { StockLocationCode } from '../../types';

export const BILLING_VERIFIED_MRP_QUERY_KEY = 'billing_verified_label_mrp';

export async function fetchBillingVerifiedLabelMrpMap(
  busyCodes: Array<number | null | undefined>,
  stockLocationCode?: StockLocationCode | null,
): Promise<Map<number, number>> {
  const codes = [
    ...new Set(
      busyCodes
        .map((c) => (c != null ? Number(c) : NaN))
        .filter((c) => Number.isFinite(c) && c > 0),
    ),
  ];
  if (codes.length === 0) return new Map();

  const { data, error } = await supabase.rpc('get_billing_verified_label_mrp_batch', {
    p_busy_codes: codes,
    p_stock_location_code: stockLocationCode ?? null,
  });

  if (error) {
    console.warn('[fetchBillingVerifiedLabelMrpMap]', error.message);
    return new Map();
  }

  const payload = data as Record<string, unknown> | null;
  if (!payload || typeof payload !== 'object') return new Map();

  const out = new Map<number, number>();
  for (const [key, value] of Object.entries(payload)) {
    const busyCode = Number(key);
    const mrp = Number(value);
    if (Number.isFinite(busyCode) && busyCode > 0 && Number.isFinite(mrp) && mrp >= 0) {
      out.set(busyCode, Math.round(mrp));
    }
  }
  return out;
}

/** Default sales rate: billing-verified label MRP when available, else catalog sales_price. */
export function defaultSalesRateForItem(
  item: { busy_code?: number | null; sales_price: number },
  verifiedMap: Map<number, number>,
): number {
  const busyCode = item.busy_code != null ? Number(item.busy_code) : NaN;
  if (Number.isFinite(busyCode) && busyCode > 0) {
    const verified = verifiedMap.get(busyCode);
    if (verified != null && verified >= 0) return verified;
  }
  return item.sales_price;
}

/** specialRate to store on cart line when verified rate differs from catalog (for submit payload). */
export function cartSpecialRateForVerified(
  item: { busy_code?: number | null; sales_price: number },
  verifiedMap: Map<number, number>,
): number | null {
  const rate = defaultSalesRateForItem(item, verifiedMap);
  return rate !== item.sales_price ? rate : null;
}
