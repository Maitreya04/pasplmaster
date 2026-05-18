import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '../lib/queryClient';
import { idbGet, idbSet } from '../lib/idb';
import type { Item } from '../types';

/**
 * Items catalog hook.
 *
 * Architecture (see senior-dev review notes in chat history):
 *
 *   1. **Initial snapshot**: when there is no local cache, paginate the full
 *      active-items table once. Cost: ~one-time ~1.5–2 MB per device.
 *
 *   2. **IndexedDB persistence**: snapshot is written to IndexedDB keyed by a
 *      cache version. On subsequent app loads we restore the catalog from
 *      disk in milliseconds — zero Supabase egress.
 *
 *   3. **Watermark delta**: every refresh asks Postgres for rows with
 *      `updated_at` just after the last successful watermark. With the
 *      `set_items_updated_at` trigger (migration 026) this is reliable for
 *      stock changes too. Typical payload: a handful of rows = a few KB.
 *
 *   4. **30s watermark poll**: reconciles catalog changes (`updated_at` deltas) via one shared
 *      timer whenever any `useItems()` consumer has mounted after a successful load.
 *
 *   5. **Stale-while-revalidate**: IndexedDB restores the full catalog immediately; Postgres sync
 *      (cold full snapshot vs delta after that) continues in the background so repeat visits skip
 *      the multi‑second spinner on flaky mobile RTT — first‑time installs still require one full sync.
 */

type ItemSyncRow = Item & { updated_at: string; is_active?: boolean | null };

interface SyncResult {
  changed: boolean;
}

/** Columns required by the UI + sync metadata. Keep this list narrow. */
const ITEMS_SELECT =
  'id,name,alias,alias1,busy_code,selling_unit,parent_group,main_group,item_category,' +
  'sales_price,mrp,stock_qty,rack_no,updated_at,is_active';

const IDB_KEY = 'items-cache-v1';
const CACHE_VERSION = 1;

/**
 * Stock/catalog freshness cadence. Each tick is a cursor delta
 * (`updated_at, id` after the last seen row), so normal empty checks are tiny
 * and bulk imports are pulled once per visible client instead of broadcast per
 * changed row.
 */
const STOCK_SYNC_INTERVAL_MS = 30_000;

/** Page size for snapshot pulls. */
const PAGE_SIZE = 1000;

interface PersistedSnapshot {
  version: number;
  items: ItemSyncRow[];
  watermark: string | null;
  watermarkId?: number;
}

/** Authoritative in-memory store. Keyed by id; values include sync metadata. */
const cachedItems: Map<number, ItemSyncRow> = new Map();

/** Max(updated_at) across cached rows, in ISO form. `null` until first sync. */
let watermark: string | null = null;
/** Highest id processed at the current watermark timestamp. */
let watermarkId = 0;

/** Last array we handed to React Query — only swap reference when contents change. */
let lastReturnedArray: Item[] = [];
let syncPromise: Promise<Item[]> | null = null;
/** Single in-flight catalog sync (delta or full snapshot) for stale-while-revalidate. */
let catalogNetworkSyncPromise: Promise<void> | null = null;

/** Singleton 30s poll — multiple `useItems()` mounts must share one timer. */
let catalogPollSubscriberCount = 0;
let catalogPollTimer: ReturnType<typeof setInterval> | null = null;

let hydrated = false;
let hydratePromise: Promise<void> | null = null;
/** Coalesces rapid bursts of realtime events into one IDB write + one cache push. */
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function isActiveRow(row: ItemSyncRow): boolean {
  return row.is_active !== false;
}

function advanceWatermark(row: ItemSyncRow): void {
  if (!watermark || row.updated_at > watermark) {
    watermark = row.updated_at;
    watermarkId = row.id;
    return;
  }
  if (row.updated_at === watermark && row.id > watermarkId) {
    watermarkId = row.id;
  }
}

function upsertRow(row: ItemSyncRow, shouldAdvanceWatermark = true): boolean {
  let changed = false;
  const existing = cachedItems.get(row.id);

  if (existing && existing.updated_at > row.updated_at) {
    if (shouldAdvanceWatermark) advanceWatermark(row);
    return false;
  }

  if (isActiveRow(row)) {
    if (!existing || existing.updated_at !== row.updated_at) {
      cachedItems.set(row.id, row);
      changed = true;
    }
  } else if (cachedItems.has(row.id)) {
    cachedItems.delete(row.id);
    changed = true;
  }
  if (shouldAdvanceWatermark) advanceWatermark(row);
  return changed;
}

async function hydrateFromIdb(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const snapshot = await idbGet<PersistedSnapshot>(IDB_KEY);
    if (
      snapshot &&
      snapshot.version === CACHE_VERSION &&
      Array.isArray(snapshot.items)
    ) {
      for (const row of snapshot.items) {
        if (isActiveRow(row)) {
          cachedItems.set(row.id, row);
        }
      }
      watermark = snapshot.watermark ?? null;
      watermarkId = snapshot.watermarkId ?? 0;
      if (watermark && watermarkId === 0) {
        for (const row of cachedItems.values()) {
          if (row.updated_at === watermark && row.id > watermarkId) {
            watermarkId = row.id;
          }
        }
      }
      lastReturnedArray = Array.from(cachedItems.values());
    }
    hydrated = true;
  })();

  return hydratePromise;
}

function schedulePersist(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void persistToIdb();
  }, 1_000);
}

async function persistToIdb(): Promise<void> {
  await idbSet<PersistedSnapshot>(IDB_KEY, {
    version: CACHE_VERSION,
    items: Array.from(cachedItems.values()),
    watermark,
    watermarkId,
  });
}

function finalizeCatalogMutation(result: SyncResult): void {
  if (result.changed || lastReturnedArray.length === 0) {
    lastReturnedArray = Array.from(cachedItems.values());
    schedulePersist();
  }
  queryClient.setQueryData<Item[]>(ITEMS_QUERY_KEY, lastReturnedArray);
}

/**
 * Loads or refreshes catalog from Postgres. Caller decides block vs fire-and-forget.
 * Errors are swallowed for background reconciliation so a prior good IDB snapshot keeps working.
 */
async function syncCatalogFromNetwork(): Promise<void> {
  await hydrateFromIdb();

  try {
    const result =
      watermark == null
        ? await fullSnapshot()
        : await deltaSync(watermark, watermarkId);
    finalizeCatalogMutation(result);
  } catch (err) {
    console.warn('[items] catalog sync failed', err);
    throw err;
  }
}

function scheduleCatalogNetworkSync(): void {
  if (catalogNetworkSyncPromise) return;

  catalogNetworkSyncPromise = (async () => {
    try {
      await syncCatalogFromNetwork();
    } catch {
      /* logged in syncCatalogFromNetwork */
    }
  })().finally(() => {
    catalogNetworkSyncPromise = null;
  });
}

function subscribeCatalogWatermarkPoll(): () => void {
  catalogPollSubscriberCount += 1;
  if (catalogPollSubscriberCount === 1 && catalogPollTimer === null) {
    catalogPollTimer = window.setInterval(() => {
      scheduleCatalogNetworkSync();
    }, STOCK_SYNC_INTERVAL_MS);
  }

  return () => {
    catalogPollSubscriberCount = Math.max(0, catalogPollSubscriberCount - 1);
    if (catalogPollSubscriberCount === 0 && catalogPollTimer !== null) {
      window.clearInterval(catalogPollTimer);
      catalogPollTimer = null;
    }
  };
}

/** Full paginated pull. Used only when there is no local watermark yet. */
async function fullSnapshot(): Promise<SyncResult> {
  let lastId = 0;
  let changed = false;

  for (;;) {
    const { data, error } = await supabase
      .from('items')
      .select(ITEMS_SELECT)
      .eq('is_active', true)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);

    if (error) throw error;
    const rows = (data ?? []) as unknown as ItemSyncRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (upsertRow(row)) {
        changed = true;
      }
      lastId = row.id;
    }
    if (rows.length < PAGE_SIZE) break;
  }

  return { changed };
}

/** Delta pull using the watermark. Also catches deactivations (is_active=false). */
async function deltaSync(since: string, sinceId: number): Promise<SyncResult> {
  let changed = false;
  let cursorUpdatedAt = since;
  let cursorId = sinceId;

  // Cursor by (updated_at, id) so bulk updates with identical timestamps are
  // processed once and subsequent polls fetch only rows after the last row seen.
  for (;;) {
    const { data, error } = await supabase
      .from('items')
      .select(ITEMS_SELECT)
      .or(`updated_at.gt.${cursorUpdatedAt},and(updated_at.eq.${cursorUpdatedAt},id.gt.${cursorId})`)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);

    if (error) throw error;
    const rows = (data ?? []) as unknown as ItemSyncRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (upsertRow(row, false)) {
        changed = true;
      }
      cursorUpdatedAt = row.updated_at;
      cursorId = row.id;
    }
    if (rows.length < PAGE_SIZE) break;
  }

  watermark = cursorUpdatedAt;
  watermarkId = cursorId;
  return { changed };
}

export const ITEMS_QUERY_KEY = ['items'] as const;

async function fetchAllItemsInternal(): Promise<Item[]> {
  await hydrateFromIdb();

  const hasWarmCatalog = cachedItems.size > 0 && watermark != null;

  if (hasWarmCatalog) {
    lastReturnedArray = Array.from(cachedItems.values());
    scheduleCatalogNetworkSync();
    return lastReturnedArray;
  }

  await syncCatalogFromNetwork();
  return lastReturnedArray;
}

export async function fetchAllItems(): Promise<Item[]> {
  if (syncPromise) return syncPromise;
  syncPromise = fetchAllItemsInternal().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

export function useItems() {
  const query = useQuery<Item[]>({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: fetchAllItems,
    /**
     * Align stale window with the stock poll so focus events do not refetch the
     * full catalog while data is still considered fresh — cuts redundant DB
     * traffic while keeping the same 30s watermark cadence.
     */
    staleTime: STOCK_SYNC_INTERVAL_MS,
    /**
     * Watermark deltas are polled from a refcounted singleton (see `subscribeCatalogWatermarkPoll`)
     * so we only run one `setInterval` for the whole app, not per `useItems()` consumer.
     */
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    /**
     * We mutate the cached items map in place and hand React Query a fresh
     * array reference on every real change, so structural sharing would only
     * mask updates.
     */
    structuralSharing: false,
  });

  useEffect(() => {
    if (!query.isSuccess) return undefined;
    return subscribeCatalogWatermarkPoll();
  }, [query.isSuccess]);

  return query;
}

/** Fire-and-forget prefetch — call early so items are warm before user needs them. */
export function prefetchItems(): void {
  void queryClient.prefetchQuery({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: fetchAllItems,
    staleTime: STOCK_SYNC_INTERVAL_MS,
  });
}
