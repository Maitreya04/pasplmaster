import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { StockLocationCode } from '../types';

const DEFAULT_STOCK_LOCATION_CODE: StockLocationCode = 'main_store';

function normalizeStockLocationCode(value: unknown): StockLocationCode {
  return value === 'jabalpur' ? 'jabalpur' : DEFAULT_STOCK_LOCATION_CODE;
}

export function useUserStockLocation(
  userId: number | null | undefined,
  userName: string | null | undefined,
) {
  return useQuery<StockLocationCode>({
    queryKey: ['user-stock-location', userId ?? 'name', userName ?? 'unknown'],
    queryFn: async () => {
      if (userId != null) {
        const { data, error } = await supabase
          .from('users')
          .select('stock_location_code')
          .eq('id', userId)
          .eq('is_active', true)
          .maybeSingle();

        if (error) throw error;
        return normalizeStockLocationCode(data?.stock_location_code);
      }

      const normalizedName = userName?.trim();
      if (!normalizedName) return DEFAULT_STOCK_LOCATION_CODE;

      const { data, error } = await supabase
        .from('users')
        .select('stock_location_code,full_name')
        .eq('is_active', true);

      if (error) throw error;

      const needle = normalizedName.toLowerCase();
      const match = (data ?? []).find((row) =>
        typeof row.full_name === 'string' &&
        row.full_name.trim().toLowerCase() === needle
      );
      return normalizeStockLocationCode(match?.stock_location_code);
    },
    staleTime: 5 * 60 * 1000,
  });
}
