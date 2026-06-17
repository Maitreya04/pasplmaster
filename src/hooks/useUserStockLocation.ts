import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { StockLocationCode } from '../types';

const DEFAULT_STOCK_LOCATION_CODE: StockLocationCode = 'main_store';
const SALESPERSON_ALIASES: Record<string, string> = {
  rajuji: 'raju',
  asadkhan: 'asad',
  manishsharma: 'manish',
  hardeepsingh: 'hardeep',
  anandawasthi: 'awasthi',
};

function normalizeStockLocationCode(value: unknown): StockLocationCode {
  return value === 'jabalpur' ? 'jabalpur' : DEFAULT_STOCK_LOCATION_CODE;
}

function normalizeSalespersonKey(value: string | null | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return SALESPERSON_ALIASES[normalized] ?? normalized;
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

      const normalizedName = normalizeSalespersonKey(userName);
      if (!normalizedName) return DEFAULT_STOCK_LOCATION_CODE;

      const { data, error } = await supabase
        .from('users')
        .select('stock_location_code,full_name')
        .eq('is_active', true);

      if (error) throw error;

      const needle = normalizedName;
      const match = (data ?? []).find((row) =>
        typeof row.full_name === 'string' &&
        normalizeSalespersonKey(row.full_name) === needle
      );
      return normalizeStockLocationCode(match?.stock_location_code);
    },
    staleTime: 5 * 60 * 1000,
    enabled: typeof navigator === 'undefined' ? true : navigator.onLine,
    retry: false,
  });
}
