import { useMemo } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { idbGet, idbSet } from '../lib/idb';
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
const IDB_KEY = 'locationwise-stock-cache-v1';
const CACHE_VERSION = 1;

interface PersistedLocationwiseStockCache {
  version: number;
  rows: Array<[number, { stock: ItemLocationStock; fetchedAt: number }]>;
}

/** Per-SKU cache survives React Query key changes (e.g. search result churn). */
const stockByBusyCodeCache = new Map<number, { stock: ItemLocationStock; fetchedAt: number }>();
let hydratedFromIdb = false;
let hydratePromise: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function emptyItemLocationStock(): ItemLocationStock {
  return {
    jabalpurStockQty: null,
    mainStoreStockQty: null,
    jabalpurPhysicalQty: null,
    mainStorePhysicalQty: null,
    jabalpurReservedQty: null,
    mainStoreReservedQty: null,
  };
}

export function normalizeBusyCodes(busyCodes: Array<number | null | undefined>): number[] {
  return [...new Set(
    busyCodes
      .map((code) => (code == null ? null : Number(code)))
      .filter((code): code is number => Number.isFinite(code)),
  )].sort((a, b) => a - b);
}

export function busyCodesQueryKey(busyCodes: number[]): string {
  return busyCodes.join(',');
}

function isCacheFresh(busyCode: number, now = Date.now()): boolean {
  const entry = stockByBusyCodeCache.get(busyCode);
  return entry != null && now - entry.fetchedAt < POLL_INTERVAL_MS;
}

async function hydrateLocationwiseStockCache(): Promise<void> {
  if (hydratedFromIdb) return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const snapshot = await idbGet<PersistedLocationwiseStockCache>(IDB_KEY);
    if (snapshot?.version === CACHE_VERSION && Array.isArray(snapshot.rows)) {
      for (const [code, entry] of snapshot.rows) {
        if (Number.isFinite(code) && entry?.stock) {
          stockByBusyCodeCache.set(Number(code), entry);
        }
      }
    }
    hydratedFromIdb = true;
  })().finally(() => {
    hydratePromise = null;
  });

  return hydratePromise;
}

function schedulePersistLocationwiseStockCache(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void idbSet<PersistedLocationwiseStockCache>(IDB_KEY, {
      version: CACHE_VERSION,
      rows: Array.from(stockByBusyCodeCache.entries()),
    });
  }, 1_000);
}

/** Call before invalidateQueries so the next fetch bypasses the in-memory SKU cache. */
export function clearLocationwiseStockCache(busyCodes?: number[]): void {
  if (!busyCodes?.length) {
    stockByBusyCodeCache.clear();
    schedulePersistLocationwiseStockCache();
    return;
  }
  for (const code of busyCodes) {
    stockByBusyCodeCache.delete(code);
  }
  schedulePersistLocationwiseStockCache();
}

export async function invalidateLocationwiseStockQueries(
  queryClient: QueryClient,
  busyCodes?: number[],
): Promise<void> {
  clearLocationwiseStockCache(busyCodes);
  await queryClient.invalidateQueries({ queryKey: ['stock_locationwise'] });
}

export function snapshotLocationwiseStockFromCache(busyCodes: number[]): Record<number, ItemLocationStock> {
  const out: Record<number, ItemLocationStock> = {};
  for (const code of busyCodes) {
    const entry = stockByBusyCodeCache.get(code);
    if (entry) out[code] = entry.stock;
  }
  return out;
}

function applyStockRow(
  stockByBusyCode: Record<number, ItemLocationStock>,
  row: StockLocationRow,
): void {
  const busyCode = row.busy_code == null ? NaN : Number(row.busy_code);
  if (!Number.isFinite(busyCode)) return;

  const stockQty = row.available_qty == null || !Number.isFinite(Number(row.available_qty))
    ? null
    : Number(row.available_qty);
  const physicalQty = row.physical_qty == null || !Number.isFinite(Number(row.physical_qty))
    ? null
    : Number(row.physical_qty);
  const reservedQty = row.reserved_qty == null || !Number.isFinite(Number(row.reserved_qty))
    ? null
    : Number(row.reserved_qty);

  const existing = stockByBusyCode[busyCode] ?? emptyItemLocationStock();

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

function writeCacheFromRows(rows: StockLocationRow[], fetchedAt: number): Record<number, ItemLocationStock> {
  const batch: Record<number, ItemLocationStock> = {};
  for (const row of rows) {
    applyStockRow(batch, row);
  }
  for (const [code, stock] of Object.entries(batch)) {
    stockByBusyCodeCache.set(Number(code), { stock, fetchedAt });
  }
  schedulePersistLocationwiseStockCache();
  return batch;
}

async function fetchLocationwiseStockRows(busyCodes: number[]): Promise<StockLocationRow[]> {
  const { data, error } = await supabase.rpc('get_locationwise_stock_for_busy_codes', {
    p_busy_codes: busyCodes,
  });
  if (error) throw error;
  return (data ?? []) as StockLocationRow[];
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

/**
 * Fetches sellable location-wise stock only for SKUs that are missing or stale
 * in the in-memory cache; returns a snapshot for the requested busy_codes.
 */
export async function fetchLocationwiseStock(
  busyCodes: number[],
): Promise<Record<number, ItemLocationStock>> {
  await hydrateLocationwiseStockCache();
  if (busyCodes.length === 0) return {};

  const now = Date.now();
  const staleCodes = busyCodes.filter((code) => !isCacheFresh(code, now));
  if (staleCodes.length > 0) {
    try {
      const rows = await fetchLocationwiseStockRows(staleCodes);
      writeCacheFromRows(rows, now);
    } catch (err) {
      const cached = snapshotLocationwiseStockFromCache(busyCodes);
      if (Object.keys(cached).length > 0) return cached;
      throw err;
    }
  }

  return snapshotLocationwiseStockFromCache(busyCodes);
}

/** True while we have no fresh cached qty for this SKU (not the whole batch). */
export function isLocationwiseStockResolving(
  busyCode: number | null | undefined,
  isFetching: boolean,
): boolean {
  if (busyCode == null || !Number.isFinite(busyCode)) return false;
  if (stockByBusyCodeCache.has(Number(busyCode))) return false;
  if (isCacheFresh(busyCode)) return false;
  return isFetching;
}

export function useLocationwiseStock(busyCodes: Array<number | null | undefined>) {
  const normalizedBusyCodes = useMemo(() => normalizeBusyCodes(busyCodes), [busyCodes]);
  const busyCodesKey = busyCodesQueryKey(normalizedBusyCodes);

  return useQuery<Record<number, ItemLocationStock>>({
    queryKey: ['stock_locationwise', busyCodesKey],
    queryFn: () => fetchLocationwiseStock(normalizedBusyCodes),
    enabled: normalizedBusyCodes.length > 0,
    staleTime: POLL_INTERVAL_MS,
    placeholderData: () => {
      const cached = snapshotLocationwiseStockFromCache(normalizedBusyCodes);
      if (Object.keys(cached).length === 0 && !hydratedFromIdb) {
        void hydrateLocationwiseStockCache();
      }
      return Object.keys(cached).length > 0 ? cached : undefined;
    },
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
