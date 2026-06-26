import type { MrpSuggestionSource, ScanResult } from '../types';

/** Map RPC suggestion_source to scan_result mrpSource. */
export function scanMrpSourceFromSuggestion(
  suggestionSource: MrpSuggestionSource,
): NonNullable<ScanResult['mrpSource']> | null {
  switch (suggestionSource) {
    case 'picker_30d':
      return 'picker_30d';
    case 'picker_verified':
      return 'picker_verified';
    case 'stock_mrpwise':
      return 'stock_mrpwise';
    case 'items_fallback':
      return 'items_fallback';
    default:
      return null;
  }
}

/** Stock band MRP for billing snapshot — not the 30-day suggested pre-fill. */
export function stockMrpFromHistory(
  data: { stock_mrp?: number | null; latest_mrp?: number | null } | null | undefined,
): number | null {
  if (data?.stock_mrp != null && data.stock_mrp > 0) return data.stock_mrp;
  if (data?.latest_mrp != null && data.latest_mrp > 0) return data.latest_mrp;
  return null;
}
