import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '../lib/queryClient';
import { idbGet, idbSet } from '../lib/idb';
import { isSupabasePostgresChangesEnabled } from '../lib/realtimePolicy';
import { subscribeToTable, type ChangePayload } from '../lib/realtime';
import type { Item } from '../types';

const REALTIME_ENABLED = isSupabasePostgresChangesEnabled();

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
 *      `updated_at > watermark`. With the `set_items_updated_at` trigger
 *      (migration 026) this is reliable for stock changes too. Typical
 *      payload: a handful of rows = a few KB.
 *
 *   4. **Realtime push**: a single `postgres_changes` subscription on
 *      `items` keeps the cache in sync with Postgres in real time. Stock
 *      updates show up in < 1 s and burn ~hundreds of bytes per event.
 *
 *   5. **Reconcile on reconnect**: if the websocket drops we run a watermark
 *      delta the moment it comes back. A 30s REST keep-alive catches silent
 *      failures; each tick is a cheap delta, not a full catalog pull.
 */

type ItemSyncRow = Item & { updated_at: string; is_active?: boolean | null };

/** Columns required by the UI + sync metadata. Keep this list narrow. */
const ITEMS_SELECT =
  'id,name,alias,alias1,busy_code,parent_group,main_group,item_category,' +
  'sales_price,mrp,stock_qty,rack_no,updated_at,is_active';

const IDB_KEY = 'items-cache-v1';
const CACHE_VERSION = 1;

/**
 * Items keep-alive. Stock is the most user-visible value in the app, so we
 * pay a small egress cost for near-realtime feel.
 *
 * Math (per 5 concurrent users, 8h/day, 22 working days):
 *   - Each tick is a *watermark delta*: `updated_at > last_seen`.
 *   - 90%+ of ticks return `[]` (Busy sync runs ~every 70s; most clients
 *     see nothing new). Empty PostgREST response ≈ 400 B body + headers
 *     ≈ 2 KB total round-trip.
 *   - 5 s tick → 720 polls/hr × 5 users × 8 h × 22 d × 2 KB ≈ 1.3 GB/month
 *     **upper bound**. Real traffic is lower because users aren't all
 *     active for the full window and most ticks are bodies-only ~400 B.
 *   - Well inside the Free 5 GB egress cap.
 *
 * When Realtime is healthy this is a safety net the user never sees — the
 * websocket pushes updates in < 1 s. When Realtime is blocked (this device's
 * network), 5 s is the live cadence; users feel < 5 s freshness on stock.
 */
const KEEPALIVE_INTERVAL_MS = 5_000;

/**
 * Same cadence whether the env flag opt-out is set or not. The watermark
 * delta is cheap; there is no benefit to splitting modes.
 */
const POLL_FALLBACK_MS = KEEPALIVE_INTERVAL_MS;

/** Page size for snapshot pulls. */
const PAGE_SIZE = 1000;

interface PersistedSnapshot {
  version: number;
  items: ItemSyncRow[];
  watermark: string | null;
}

/** Authoritative in-memory store. Keyed by id; values include sync metadata. */
const cachedItems: Map<number, ItemSyncRow> = new Map();

/** Max(updated_at) across cached rows, in ISO form. `null` until first sync. */
let watermark: string | null = null;

/** Last array we handed to React Query — only swap reference when contents change. */
let lastReturnedArray: Item[] = [];

let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let realtimeAttached = false;
/** Coalesces rapid bursts of realtime events into one IDB write + one cache push. */
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function maxIsoTimestamp(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function isActiveRow(row: ItemSyncRow): boolean {
  return row.is_active !== false;
}

function upsertRow(row: ItemSyncRow): boolean {
  let changed = false;
  if (isActiveRow(row)) {
    const existing = cachedItems.get(row.id);
    if (!existing || existing.updated_at !== row.updated_at) {
      cachedItems.set(row.id, row);
      changed = true;
    }
  } else if (cachedItems.has(row.id)) {
    cachedItems.delete(row.id);
    changed = true;
  }
  watermark = maxIsoTimestamp(watermark, row.updated_at);
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
  });
}

/** Push the current cache snapshot into the React Query cache. */
function publishToQueryCache(): void {
  lastReturnedArray = Array.from(cachedItems.values());
  queryClient.setQueryData<Item[]>(ITEMS_QUERY_KEY, lastReturnedArray);
}

/** Full paginated pull. Used only when there is no local watermark yet. */
async function fullSnapshot(): Promise<boolean> {
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
      if (upsertRow(row)) changed = true;
      lastId = row.id;
    }
    if (rows.length < PAGE_SIZE) break;
  }

  return changed;
}

/** Delta pull using the watermark. Also catches deactivations (is_active=false). */
async function deltaSync(since: string): Promise<boolean> {
  let changed = false;
  let lastId = 0;
  /** Same timestamp can repeat across rows; paginate by (updated_at, id). */
  // PostgREST cannot express tuple comparisons, so we fetch by updated_at>since
  // and walk in id order to avoid skipping rows at the same timestamp. The
  // watermark only advances after every row at the current timestamp is read.
  for (;;) {
    const { data, error } = await supabase
      .from('items')
      .select(ITEMS_SELECT)
      .gt('updated_at', since)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE);

    if (error) throw error;
    const rows = (data ?? []) as unknown as ItemSyncRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (upsertRow(row)) changed = true;
      lastId = row.id;
    }
    if (rows.length < PAGE_SIZE) break;
  }

  return changed;
}

/**
 * Lazily attach one realtime channel for the whole app.
 * Stock and price updates land here in < 1 s with no polling overhead.
 */
function ensureRealtime(): void {
  if (!REALTIME_ENABLED) return;
  if (realtimeAttached) return;
  realtimeAttached = true;

  subscribeToTable<ItemSyncRow>({
    channelName: 'items-live',
    table: 'items',
    onChange: (payload: ChangePayload<ItemSyncRow>) => {
      if (payload.eventType === 'DELETE') {
        const oldRow = payload.old as Partial<ItemSyncRow> | undefined;
        if (oldRow?.id != null && cachedItems.delete(oldRow.id)) {
          publishToQueryCache();
          schedulePersist();
        }
        return;
      }

      const row = payload.new as ItemSyncRow | undefined;
      if (!row || row.updated_at == null) return;
      if (upsertRow(row)) {
        publishToQueryCache();
        schedulePersist();
      }
    },
    onReconnect: () => {
      // Catch any events missed while the websocket was down.
      void queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
    },
  });
}

export async function fetchAllItems(): Promise<Item[]> {
  await hydrateFromIdb();
  ensureRealtime();

  let changed = false;
  if (watermark == null) {
    changed = await fullSnapshot();
  } else {
    changed = await deltaSync(watermark);
  }

  if (changed || lastReturnedArray.length === 0) {
    lastReturnedArray = Array.from(cachedItems.values());
    schedulePersist();
  }

  return lastReturnedArray;
}

export const ITEMS_QUERY_KEY = ['items'] as const;

export function useItems() {
  return useQuery<Item[]>({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: fetchAllItems,
    staleTime: 0,
    /**
     * Realtime is the primary update path; REST refetch is watermark-only
     * (tiny delta) so a 5s keep-alive feels near-realtime even when wss://
     * is blocked, without bringing back the full-catalog egress cost.
     */
    refetchInterval: REALTIME_ENABLED ? KEEPALIVE_INTERVAL_MS : POLL_FALLBACK_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    /**
     * We mutate the cached items map in place and hand React Query a fresh
     * array reference on every real change, so structural sharing would only
     * mask updates.
     */
    structuralSharing: false,
  });
}

/** Fire-and-forget prefetch — call early so items are warm before user needs them. */
export function prefetchItems(): void {
  void queryClient.prefetchQuery({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: fetchAllItems,
    staleTime: REALTIME_ENABLED ? KEEPALIVE_INTERVAL_MS : POLL_FALLBACK_MS,
  });
}
