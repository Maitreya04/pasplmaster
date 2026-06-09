import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '../lib/queryClient';
import { idbGet, idbSet } from '../lib/idb';
import type { Transport } from '../types';

const IDB_KEY = 'transports-cache-v1';
const CACHE_VERSION = 1;
export const TRANSPORTS_QUERY_KEY = ['transports'] as const;

type TransportSyncRow = Transport & { updated_at?: string; is_active?: boolean | null };

interface PersistedTransports {
  version: number;
  rows: TransportSyncRow[];
  watermark: string | null;
  watermarkId: number;
}

const cachedTransports = new Map<number, TransportSyncRow>();
let lastReturnedArray: Transport[] = [];
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let networkSyncPromise: Promise<void> | null = null;
let watermark: string | null = null;
let watermarkId = 0;

function isActive(row: TransportSyncRow): boolean {
  return row.is_active !== false;
}

function advanceWatermark(row: TransportSyncRow): void {
  if (!row.updated_at) return;
  if (!watermark || row.updated_at > watermark) {
    watermark = row.updated_at;
    watermarkId = row.id;
    return;
  }
  if (row.updated_at === watermark && row.id > watermarkId) {
    watermarkId = row.id;
  }
}

function upsertRow(row: TransportSyncRow): boolean {
  const existing = cachedTransports.get(row.id);
  if (existing?.updated_at && row.updated_at && existing.updated_at > row.updated_at) {
    advanceWatermark(row);
    return false;
  }
  let changed = false;
  if (isActive(row)) {
    if (!existing || existing.updated_at !== row.updated_at) {
      cachedTransports.set(row.id, row);
      changed = true;
    }
  } else if (cachedTransports.has(row.id)) {
    cachedTransports.delete(row.id);
    changed = true;
  }
  advanceWatermark(row);
  return changed;
}

async function hydrateFromIdb(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const snapshot = await idbGet<PersistedTransports>(IDB_KEY);
    if (snapshot?.version === CACHE_VERSION && Array.isArray(snapshot.rows)) {
      cachedTransports.clear();
      for (const row of snapshot.rows) {
        if (isActive(row)) cachedTransports.set(row.id, row);
      }
      watermark = snapshot.watermark ?? null;
      watermarkId = snapshot.watermarkId ?? 0;
      lastReturnedArray = Array.from(cachedTransports.values());
    }
    hydrated = true;
  })();
  return hydratePromise;
}

async function persistToIdb(): Promise<void> {
  await idbSet<PersistedTransports>(IDB_KEY, {
    version: CACHE_VERSION,
    rows: Array.from(cachedTransports.values()),
    watermark,
    watermarkId,
  });
}

function publishTransports(changed: boolean): void {
  if (changed || lastReturnedArray.length === 0) {
    lastReturnedArray = Array.from(cachedTransports.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    void persistToIdb();
  }
  queryClient.setQueryData<Transport[]>(TRANSPORTS_QUERY_KEY, lastReturnedArray);
}

async function fullSnapshot(): Promise<boolean> {
  const { data, error } = await supabase
    .from('transports')
    .select('*')
    .eq('is_active', true)
    .order('name');

  if (error) throw error;
  cachedTransports.clear();
  watermark = null;
  watermarkId = 0;
  for (const row of (data ?? []) as TransportSyncRow[]) {
    if (isActive(row)) cachedTransports.set(row.id, row);
    advanceWatermark(row);
  }
  return true;
}

async function deltaSync(): Promise<boolean> {
  if (!watermark) return fullSnapshot();
  const { data, error } = await supabase
    .from('transports')
    .select('*')
    .or(`updated_at.gt.${watermark},and(updated_at.eq.${watermark},id.gt.${watermarkId})`)
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw error;
  let changed = false;
  for (const row of (data ?? []) as TransportSyncRow[]) {
    changed = upsertRow(row) || changed;
  }
  return changed;
}

async function syncTransportsFromNetwork(): Promise<void> {
  await hydrateFromIdb();
  const changed = await deltaSync();
  publishTransports(changed);
}

function scheduleTransportNetworkSync(): void {
  if (networkSyncPromise) return;
  networkSyncPromise = syncTransportsFromNetwork()
    .catch((err) => {
      console.warn('[transports] sync failed', err);
    })
    .finally(() => {
      networkSyncPromise = null;
    });
}

async function loadTransports(): Promise<Transport[]> {
  await hydrateFromIdb();
  if (lastReturnedArray.length > 0) {
    scheduleTransportNetworkSync();
    return lastReturnedArray;
  }
  await syncTransportsFromNetwork();
  return lastReturnedArray;
}

export function prefetchTransports(): Promise<Transport[]> {
  return queryClient.fetchQuery({
    queryKey: TRANSPORTS_QUERY_KEY,
    queryFn: loadTransports,
    staleTime: 60 * 60 * 1000,
  });
}

export function useTransports() {
  return useQuery<Transport[]>({
    queryKey: TRANSPORTS_QUERY_KEY,
    queryFn: loadTransports,
    staleTime: 60 * 60 * 1000,
  });
}
