import { useMemo } from 'react';
import { useStockMrpHistory } from '../../../hooks/useStockMrpHistory';
import { pickLineMrpLookup } from '../../../lib/picking/pickLineMrp';
import type {
  MrpSuggestionSource,
  OrderItem,
  StockMrpHistoryEntry,
  StockLocationCode,
} from '../../../types';

export type MrpSuggestion = {
  suggestedMrp: number | null;
  stockMrp: number | null;
  alternates: StockMrpHistoryEntry[];
  suggestionSource: MrpSuggestionSource;
  historyCount: number;
  isLoading: boolean;
  isError: boolean;
};

function roundMrp(value: number): number {
  return Math.round(value);
}

export function useMrpSuggestion(
  orderItem: OrderItem | null | undefined,
  enabled = true,
): MrpSuggestion {
  const { busyCode, itemsMrpFallback } = useMemo(
    () => (orderItem ? pickLineMrpLookup(orderItem) : { busyCode: null, itemsMrpFallback: null }),
    [orderItem],
  );

  const stockLocationCode =
    (orderItem?.stock_location_code as StockLocationCode | null | undefined) ?? null;

  const { data, isLoading, isError } = useStockMrpHistory(
    busyCode,
    stockLocationCode,
    itemsMrpFallback,
    enabled && orderItem != null,
  );

  return useMemo(() => {
    const suggestedMrp =
      data?.suggested_mrp != null && data.suggested_mrp > 0
        ? roundMrp(data.suggested_mrp)
        : data?.latest_mrp != null && data.latest_mrp > 0
          ? roundMrp(data.latest_mrp)
          : null;

    const stockMrp =
      data?.stock_mrp != null && data.stock_mrp > 0 ? roundMrp(data.stock_mrp) : null;

    const history = data?.history ?? [];
    const alternates = history
      .filter((h) => suggestedMrp == null || roundMrp(h.mrp) !== suggestedMrp)
      .slice(0, 4);

    return {
      suggestedMrp,
      stockMrp,
      alternates,
      suggestionSource: data?.suggestion_source ?? 'empty',
      historyCount: history.length,
      isLoading,
      isError,
    };
  }, [data, isError, isLoading]);
}
