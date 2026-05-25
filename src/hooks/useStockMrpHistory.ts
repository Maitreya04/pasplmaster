import { useQuery } from '@tanstack/react-query';
import { fetchStockMrpHistory, STOCK_MRP_HISTORY_QUERY_KEY } from '../lib/stockMrpwise';
import type { StockLocationCode, StockMrpHistoryResult } from '../types';

export function stockMrpHistoryQueryKey(
  busyCode: number | null | undefined,
  stockLocationCode?: StockLocationCode | null,
): readonly [string, number | null, StockLocationCode | null | undefined] {
  const code = busyCode != null && Number.isFinite(Number(busyCode)) ? Number(busyCode) : null;
  return [STOCK_MRP_HISTORY_QUERY_KEY, code, stockLocationCode ?? null];
}

export function useStockMrpHistory(
  busyCode: number | null | undefined,
  stockLocationCode?: StockLocationCode | null,
  itemsMrpFallback?: number | null,
  enabled = true,
): {
  data: StockMrpHistoryResult | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: stockMrpHistoryQueryKey(busyCode, stockLocationCode),
    queryFn: () => fetchStockMrpHistory(busyCode, stockLocationCode, itemsMrpFallback),
    enabled: enabled && (busyCode != null || (itemsMrpFallback != null && itemsMrpFallback > 0)),
    staleTime: 60_000,
  });

  return { data, isLoading, isError };
}
