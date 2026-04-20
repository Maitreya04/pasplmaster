import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';

export interface ItemLocationStock {
  jabalpurStockQty: number | null;
  mainStoreStockQty: number | null;
}

export type StockLocationRow = {
  busy_code: number | null;
  stock_location: string | null;
  stock_qty: number | null;
};

const POLL_INTERVAL_MS = 30_000;

export function normalizeBusyCodes(busyCodes: Array<number | null | undefined>): number[] {
  return [...new Set(
    busyCodes
      .map((code) => (code == null ? null : Number(code)))
      .filter((code): code is number => Number.isFinite(code)),
  )].sort((a, b) => a - b);
}

export function normalizeLocationLabel(stockLocation: string | null | undefined): string | null {
  const normalized = stockLocation?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'jbp') return 'Jabalpur';
  if (normalized === 'main store') return 'Indore';
  return stockLocation?.trim() ?? null;
}

export async function fetchLocationwiseStock(
  busyCodes: number[],
): Promise<Record<number, ItemLocationStock>> {
  if (busyCodes.length === 0) return {};

  const { data, error } = await supabase
    .from('stock_locationwise')
    .select('busy_code,stock_location,stock_qty')
    .in('busy_code', busyCodes);

  if (error) throw error;

  const rows = (data ?? []) as StockLocationRow[];
  const stockByBusyCode: Record<number, ItemLocationStock> = {};

  for (const row of rows) {
    const busyCode = row.busy_code == null ? NaN : Number(row.busy_code);
    if (!Number.isFinite(busyCode)) continue;

    const locationLabel = normalizeLocationLabel(row.stock_location);
    const stockQty = row.stock_qty == null || !Number.isFinite(Number(row.stock_qty))
      ? null
      : Number(row.stock_qty);

    const existing = stockByBusyCode[busyCode] ?? {
      jabalpurStockQty: null,
      mainStoreStockQty: null,
    };

    if (locationLabel === 'Jabalpur') existing.jabalpurStockQty = stockQty;
    if (locationLabel === 'Indore') existing.mainStoreStockQty = stockQty;

    stockByBusyCode[busyCode] = existing;
  }

  return stockByBusyCode;
}

export function useLocationwiseStock(busyCodes: Array<number | null | undefined>) {
  const normalizedBusyCodes = useMemo(() => normalizeBusyCodes(busyCodes), [busyCodes]);

  return useQuery<Record<number, ItemLocationStock>>({
    queryKey: ['stock_locationwise', normalizedBusyCodes],
    queryFn: () => fetchLocationwiseStock(normalizedBusyCodes),
    enabled: normalizedBusyCodes.length > 0,
    staleTime: 0,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
