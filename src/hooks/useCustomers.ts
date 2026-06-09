import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '../lib/queryClient';
import { idbGet, idbSet } from '../lib/idb';
import type { Customer } from '../types';

const BATCH_SIZE = 1000;
const IDB_KEY = 'customers-cache-v1';
const CACHE_VERSION = 1;
export const CUSTOMERS_QUERY_KEY = ['customers'] as const;

type CustomerSyncRow = Customer & { updated_at?: string; is_active?: boolean | null };

interface PersistedCustomers {
  version: number;
  rows: CustomerSyncRow[];
  watermark: string | null;
  watermarkId: number;
}

const cachedCustomers = new Map<number, CustomerSyncRow>();
let lastReturnedArray: Customer[] = [];
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let networkSyncPromise: Promise<void> | null = null;
let watermark: string | null = null;
let watermarkId = 0;

function isActive(row: CustomerSyncRow): boolean {
  return row.is_active !== false;
}

function advanceWatermark(row: CustomerSyncRow): void {
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

function upsertRow(row: CustomerSyncRow): boolean {
  const existing = cachedCustomers.get(row.id);
  if (existing?.updated_at && row.updated_at && existing.updated_at > row.updated_at) {
    advanceWatermark(row);
    return false;
  }
  let changed = false;
  if (isActive(row)) {
    if (!existing || existing.updated_at !== row.updated_at) {
      cachedCustomers.set(row.id, row);
      changed = true;
    }
  } else if (cachedCustomers.has(row.id)) {
    cachedCustomers.delete(row.id);
    changed = true;
  }
  advanceWatermark(row);
  return changed;
}

async function hydrateFromIdb(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const snapshot = await idbGet<PersistedCustomers>(IDB_KEY);
    if (snapshot?.version === CACHE_VERSION && Array.isArray(snapshot.rows)) {
      cachedCustomers.clear();
      for (const row of snapshot.rows) {
        if (isActive(row)) cachedCustomers.set(row.id, row);
      }
      watermark = snapshot.watermark ?? null;
      watermarkId = snapshot.watermarkId ?? 0;
      lastReturnedArray = Array.from(cachedCustomers.values());
    }
    hydrated = true;
  })();
  return hydratePromise;
}

async function persistToIdb(): Promise<void> {
  await idbSet<PersistedCustomers>(IDB_KEY, {
    version: CACHE_VERSION,
    rows: Array.from(cachedCustomers.values()),
    watermark,
    watermarkId,
  });
}

function publishCustomers(changed: boolean): void {
  if (changed || lastReturnedArray.length === 0) {
    lastReturnedArray = Array.from(cachedCustomers.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    void persistToIdb();
  }
  queryClient.setQueryData<Customer[]>(CUSTOMERS_QUERY_KEY, lastReturnedArray);
}

async function fetchAllCustomers(): Promise<Customer[]> {
  const { count, error: countErr } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  if (countErr) throw countErr;
  if (!count) return [];

  const batches = Math.ceil(count / BATCH_SIZE);
  const promises = Array.from({ length: batches }, (_, i) => {
    const from = i * BATCH_SIZE;
    return supabase
      .from('customers')
      .select('*')
      .eq('is_active', true)
      .range(from, from + BATCH_SIZE - 1)
      .order('id');
  });

  const results = await Promise.all(promises);
  const allCustomers: Customer[] = new Array(count);
  let offset = 0;

  for (const { data, error } of results) {
    if (error) throw error;
    if (data) {
      for (let i = 0; i < data.length; i++) {
        allCustomers[offset + i] = data[i] as Customer;
      }
      offset += data.length;
    }
  }

  return allCustomers.slice(0, offset);
}

async function fullSnapshot(): Promise<boolean> {
  const rows = (await fetchAllCustomers()) as CustomerSyncRow[];
  cachedCustomers.clear();
  watermark = null;
  watermarkId = 0;
  for (const row of rows) {
    if (isActive(row)) cachedCustomers.set(row.id, row);
    advanceWatermark(row);
  }
  return true;
}

async function deltaSync(): Promise<boolean> {
  if (!watermark) return fullSnapshot();

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(`updated_at.gt.${watermark},and(updated_at.eq.${watermark},id.gt.${watermarkId})`)
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) throw error;
  let changed = false;
  for (const row of (data ?? []) as CustomerSyncRow[]) {
    changed = upsertRow(row) || changed;
  }
  return changed;
}

async function syncCustomersFromNetwork(): Promise<void> {
  await hydrateFromIdb();
  const changed = await deltaSync();
  publishCustomers(changed);
}

function scheduleCustomerNetworkSync(): void {
  if (networkSyncPromise) return;
  networkSyncPromise = syncCustomersFromNetwork()
    .catch((err) => {
      console.warn('[customers] sync failed', err);
    })
    .finally(() => {
      networkSyncPromise = null;
    });
}

async function loadCustomers(): Promise<Customer[]> {
  await hydrateFromIdb();
  if (lastReturnedArray.length > 0) {
    scheduleCustomerNetworkSync();
    return lastReturnedArray;
  }
  await syncCustomersFromNetwork();
  return lastReturnedArray;
}

export function prefetchCustomers(): Promise<Customer[]> {
  return queryClient.fetchQuery({
    queryKey: CUSTOMERS_QUERY_KEY,
    queryFn: loadCustomers,
    staleTime: 30 * 60 * 1000,
  });
}

export function useCustomers() {
  return useQuery<Customer[]>({
    queryKey: CUSTOMERS_QUERY_KEY,
    queryFn: loadCustomers,
    staleTime: 30 * 60 * 1000,
  });
}
