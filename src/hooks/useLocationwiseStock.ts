import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { StockLocationCode } from '../types';

export interface ItemLocationStock {
  jabalpurStockQty: number | null;
  mainStoreStockQty: number | null;
  jabalpurPhysicalQty: number | null;
  mainStorePhysicalQty: number | null;
  jabalpurReservedQty: number | null;
  mainStoreReservedQty: number | null;
}

export type StockLocationRow = {
  busy_code: number | null;
  stock_location_code: StockLocationCode | null;
  available_qty: number | null;
  physical_qty: number | null;
  reserved_qty: number | null;
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
  if (normalized === 'jbp' || normalized === 'jbl' || normalized === 'jabalpur') return 'Jabalpur';
  if (normalized === 'main store' || normalized === 'mainstore' || normalized === 'indore') return 'Indore';
  return stockLocation?.trim() ?? null;
}

export function stockLocationLabel(stockLocationCode: StockLocationCode): string {
  return stockLocationCode === 'jabalpur' ? 'Jabalpur' : 'Main Store';
}

export function getStockQtyForLocation(
  stock: ItemLocationStock | undefined,
  stockLocationCode: StockLocationCode,
): number | null {
  return stockLocationCode === 'jabalpur'
    ? stock?.jabalpurStockQty ?? null
    : stock?.mainStoreStockQty ?? null;
}

export async function fetchLocationwiseStock(
  busyCodes: number[],
): Promise<Record<number, ItemLocationStock>> {
  if (busyCodes.length === 0) return {};

  const { data, error } = await supabase
    .from('locationwise_stock_available')
    .select('busy_code,stock_location_code,available_qty,physical_qty,reserved_qty')
    .in('busy_code', busyCodes);

  if (error) throw error;

  const rows = (data ?? []) as StockLocationRow[];
  const stockByBusyCode: Record<number, ItemLocationStock> = {};

  for (const row of rows) {
    const busyCode = row.busy_code == null ? NaN : Number(row.busy_code);
    if (!Number.isFinite(busyCode)) continue;

    const stockQty = row.available_qty == null || !Number.isFinite(Number(row.available_qty))
      ? null
      : Number(row.available_qty);
    const physicalQty = row.physical_qty == null || !Number.isFinite(Number(row.physical_qty))
      ? null
      : Number(row.physical_qty);
    const reservedQty = row.reserved_qty == null || !Number.isFinite(Number(row.reserved_qty))
      ? null
      : Number(row.reserved_qty);

    const existing = stockByBusyCode[busyCode] ?? {
      jabalpurStockQty: null,
      mainStoreStockQty: null,
      jabalpurPhysicalQty: null,
      mainStorePhysicalQty: null,
      jabalpurReservedQty: null,
      mainStoreReservedQty: null,
    };

    if (row.stock_location_code === 'jabalpur') {
      existing.jabalpurStockQty = stockQty;
      existing.jabalpurPhysicalQty = physicalQty;
      existing.jabalpurReservedQty = reservedQty;
    }
    if (row.stock_location_code === 'main_store') {
      existing.mainStoreStockQty = stockQty;
      existing.mainStorePhysicalQty = physicalQty;
      existing.mainStoreReservedQty = reservedQty;
    }

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
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
