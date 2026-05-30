import { useQuery } from '@tanstack/react-query';
import {
  BILLING_VERIFIED_MRP_QUERY_KEY,
  fetchBillingVerifiedLabelMrpMap,
} from '../lib/billing/billingVerifiedMrp';
import type { StockLocationCode } from '../types';

export function useBillingVerifiedLabelMrpMap(
  busyCodes: Array<number | null | undefined>,
  stockLocationCode?: StockLocationCode | null,
  enabled = true,
): {
  data: Map<number, number>;
  isLoading: boolean;
} {
  const normalizedCodes = [
    ...new Set(
      busyCodes
        .map((c) => (c != null ? Number(c) : NaN))
        .filter((c) => Number.isFinite(c) && c > 0)
        .sort((a, b) => a - b),
    ),
  ];

  const { data, isLoading } = useQuery({
    queryKey: [BILLING_VERIFIED_MRP_QUERY_KEY, normalizedCodes, stockLocationCode ?? null],
    queryFn: () => fetchBillingVerifiedLabelMrpMap(normalizedCodes, stockLocationCode),
    enabled: enabled && normalizedCodes.length > 0,
    staleTime: 60_000,
  });

  return { data: data ?? new Map(), isLoading };
}
