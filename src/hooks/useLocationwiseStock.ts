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
  jabalpurSourceUpdatedAt: string | null;
  mainStoreSourceUpdatedAt: string | null;
  jabalpurDeviceSyncedAt: string | null;
  mainStoreDeviceSyncedAt: string | null;
}

export type StockLocationRow = {
  busy_code: number | null;
  stock_location_code: StockLocationCode | null;
  available_qty: number | null;
  physical_qty: number | null;
  reserved_qty: number | null;
  latest_stock_updated_at?: string | null;
};

/** How long cached per-SKU stock qty stays fresh before refetching. */
const STOCK_CACHE_TTL_MS = 5 * 60 * 1000;
const STOCK_FETCH_TIMEOUT_MS = 10_000;
const IDB_KEY = 'locationwise-stock-cache-v1';
const CACHE_VERSION = 2;
const WARMUP_CHUNK_SIZE = 200;

interface PersistedLocationwiseStockCache {
  version: number;
  rows: Array<[number, { stock: ItemLocationStock; fetchedAt: number }]>;
}

/** Per-SKU cache survives React Query key changes (e.g. search result churn). */
const stockByBusyCodeCache = new Map<number, { stock: ItemLocationStock; fetchedAt: number }>();
let hydratedFromIdb = false;
let hydratePromise: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let warmupPromise: Promise<void> | null = null;

function emptyItemLocationStock(): ItemLocationStock {
  return {
    jabalpurStockQty: null,
    mainStoreStockQty: null,
    jabalpurPhysicalQty: null,
    mainStorePhysicalQty: null,
    jabalpurReservedQty: null,
    mainStoreReservedQty: null,
    jabalpurSourceUpdatedAt: null,
    mainStoreSourceUpdatedAt: null,
    jabalpurDeviceSyncedAt: null,
    mainStoreDeviceSyncedAt: null,
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
  return entry != null && now - entry.fetchedAt < STOCK_CACHE_TTL_MS;
}

async function hydrateLocationwiseStockCache(): Promise<void> {
  if (hydratedFromIdb) return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const snapshot = await idbGet<PersistedLocationwiseStockCache>(IDB_KEY);
    if (
      snapshot &&
      (snapshot.version === CACHE_VERSION || snapshot.version === 1) &&
      Array.isArray(snapshot.rows)
    ) {
      for (const [code, entry] of snapshot.rows) {
        if (Number.isFinite(code) && entry?.stock) {
          stockByBusyCodeCache.set(Number(code), {
            fetchedAt: entry.fetchedAt,
            stock: normalizeHydratedStock(entry.stock, entry.fetchedAt),
          });
        }
      }
    }
    hydratedFromIdb = true;
  })().finally(() => {
    hydratePromise = null;
  });

  return hydratePromise;
}

function normalizeHydratedStock(stock: ItemLocationStock, fetchedAt: number): ItemLocationStock {
  const syncedAt = Number.isFinite(fetchedAt) ? new Date(fetchedAt).toISOString() : null;
  return {
    ...emptyItemLocationStock(),
    ...stock,
    mainStoreDeviceSyncedAt:
      stock.mainStoreDeviceSyncedAt ?? (stock.mainStoreStockQty != null ? syncedAt : null),
    jabalpurDeviceSyncedAt:
      stock.jabalpurDeviceSyncedAt ?? (stock.jabalpurStockQty != null ? syncedAt : null),
    mainStoreSourceUpdatedAt: stock.mainStoreSourceUpdatedAt ?? null,
    jabalpurSourceUpdatedAt: stock.jabalpurSourceUpdatedAt ?? null,
  };
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
  deviceSyncedAt: string,
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

  const existing =
    stockByBusyCode[busyCode] ??
    stockByBusyCodeCache.get(busyCode)?.stock ??
    emptyItemLocationStock();

  if (row.stock_location_code === 'jabalpur') {
    existing.jabalpurStockQty = stockQty;
    existing.jabalpurPhysicalQty = physicalQty;
    existing.jabalpurReservedQty = reservedQty;
    existing.jabalpurSourceUpdatedAt = row.latest_stock_updated_at ?? null;
    existing.jabalpurDeviceSyncedAt = deviceSyncedAt;
  }
  if (row.stock_location_code === 'main_store') {
    existing.mainStoreStockQty = stockQty;
    existing.mainStorePhysicalQty = physicalQty;
    existing.mainStoreReservedQty = reservedQty;
    existing.mainStoreSourceUpdatedAt = row.latest_stock_updated_at ?? null;
    existing.mainStoreDeviceSyncedAt = deviceSyncedAt;
  }

  stockByBusyCode[busyCode] = existing;
}

function writeCacheFromRows(rows: StockLocationRow[], fetchedAt: number): Record<number, ItemLocationStock> {
  const batch: Record<number, ItemLocationStock> = {};
  const deviceSyncedAt = new Date(fetchedAt).toISOString();
  for (const row of rows) {
    applyStockRow(batch, row, deviceSyncedAt);
  }
  for (const [code, stock] of Object.entries(batch)) {
    stockByBusyCodeCache.set(Number(code), { stock, fetchedAt });
  }
  schedulePersistLocationwiseStockCache();
  return batch;
}

async function fetchLocationwiseStockRows(busyCodes: number[]): Promise<StockLocationRow[]> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const { data, error } = await Promise.race([
    supabase.rpc('get_locationwise_stock_for_busy_codes', {
      p_busy_codes: busyCodes,
    }),
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('stock_fetch_timeout')), STOCK_FETCH_TIMEOUT_MS);
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
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

export function getStockDeviceSyncedAtForLocation(
  stock: ItemLocationStock | undefined,
  stockLocationCode: StockLocationCode,
): string | null {
  return stockLocationCode === 'jabalpur'
    ? stock?.jabalpurDeviceSyncedAt ?? null
    : stock?.mainStoreDeviceSyncedAt ?? null;
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

export async function prefetchLocationwiseStockForItems(
  items: Array<{ busy_code?: number | null }>,
): Promise<void> {
  if (warmupPromise) return warmupPromise;
  const busyCodes = normalizeBusyCodes(items.map((item) => item.busy_code));
  if (busyCodes.length === 0) return;

  warmupPromise = (async () => {
    await hydrateLocationwiseStockCache();
    for (let i = 0; i < busyCodes.length; i += WARMUP_CHUNK_SIZE) {
      const chunk = busyCodes.slice(i, i + WARMUP_CHUNK_SIZE);
      try {
        await fetchLocationwiseStock(chunk);
      } catch (err) {
        console.warn('[stock_locationwise] warmup failed', err);
        break;
      }
    }
  })().finally(() => {
    warmupPromise = null;
  });

  return warmupPromise;
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
    staleTime: STOCK_CACHE_TTL_MS,
    placeholderData: () => {
      const cached = snapshotLocationwiseStockFromCache(normalizedBusyCodes);
      if (Object.keys(cached).length === 0 && !hydratedFromIdb) {
        void hydrateLocationwiseStockCache();
      }
      return Object.keys(cached).length > 0 ? cached : undefined;
    },
    refetchInterval: STOCK_CACHE_TTL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: false,
  });
}

export function getOldestLocationwiseStockSyncedAt(
  busyCodes: number[],
  locationCode: StockLocationCode,
): Date | null {
  let oldestMs: number | null = null;
  for (const busyCode of busyCodes) {
    const entry = stockByBusyCodeCache.get(busyCode);
    if (!entry) continue;
    const syncedAtIso =
      locationCode === 'jabalpur'
        ? entry.stock.jabalpurDeviceSyncedAt
        : entry.stock.mainStoreDeviceSyncedAt;
    const candidate = syncedAtIso ? new Date(syncedAtIso).getTime() : entry.fetchedAt;
    if (!Number.isFinite(candidate)) continue;
    if (oldestMs == null || candidate < oldestMs) oldestMs = candidate;
  }
  return oldestMs == null ? null : new Date(oldestMs);
}
