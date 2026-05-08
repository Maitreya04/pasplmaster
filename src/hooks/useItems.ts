import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '../lib/queryClient';
import type { Item } from '../types';

type ItemSyncRow = Item & { updated_at: string; is_active?: boolean | null };

const ITEMS_SELECT =
  'id,name,alias,alias1,busy_code,parent_group,main_group,item_category,sales_price,mrp,stock_qty,rack_no';

/** Poll frequently so stock updates are reflected quickly in the billing UI. */
const POLL_INTERVAL_MS = 10_000;

const cachedItems: Map<number, Item> = new Map();
let lastReturnedArray: Item[] = [];

function hasItemChanged(prev: Item | undefined, next: ItemSyncRow): boolean {
  if (!prev) return true;
  return (
    prev.id !== next.id ||
    prev.name !== next.name ||
    prev.alias !== next.alias ||
    prev.alias1 !== next.alias1 ||
    prev.busy_code !== next.busy_code ||
    prev.parent_group !== next.parent_group ||
    prev.main_group !== next.main_group ||
    prev.item_category !== next.item_category ||
    prev.sales_price !== next.sales_price ||
    prev.mrp !== next.mrp ||
    prev.stock_qty !== next.stock_qty ||
    prev.rack_no !== next.rack_no
  );
}

export async function fetchAllItems(): Promise<Item[]> {
  // Always run a full active-items sync.
  // Some upstream stock update paths can change stock_qty without bumping updated_at,
  // which makes delta-sync by updated_at miss real inventory changes.
  let allFetched = false;
  let lastId = 0;
  let hasChanges = false;
  const seenIds = new Set<number>();

  while (!allFetched) {
    const { data: rawData, error } = await supabase
      .from('items')
      .select(ITEMS_SELECT + ',updated_at,is_active')
      .eq('is_active', true)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(1000);

    const data = (rawData ?? []) as unknown as ItemSyncRow[];

    if (error) throw error;
    if (data.length === 0) {
      allFetched = true;
      break;
    }

    for (const item of data) {
      seenIds.add(item.id);
      const prev = cachedItems.get(item.id);
      if (hasItemChanged(prev, item)) {
        hasChanges = true;
      }
      cachedItems.set(item.id, item);
      lastId = item.id;
    }

    if (data.length < 1000) {
      allFetched = true;
    }
  }

  // Remove items that are no longer active/present.
  for (const id of Array.from(cachedItems.keys())) {
    if (!seenIds.has(id)) {
      cachedItems.delete(id);
      hasChanges = true;
    }
  }

  if (hasChanges || lastReturnedArray.length === 0) {
    lastReturnedArray = Array.from(cachedItems.values());
    console.log(`[useItems] cache updated. Total active items: ${lastReturnedArray.length}`);
  }

  return lastReturnedArray;
}

export const ITEMS_QUERY_KEY = ['items'] as const;

export function useItems() {
  return useQuery<Item[]>({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: fetchAllItems,
    staleTime: 0,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // Disable structural sharing so React Query always returns a new array
    // reference, forcing useMemo/search index to rebuild with fresh data.
    structuralSharing: false,
  });
}

/** Fire-and-forget prefetch — call early so items are cached before user needs them. */
export function prefetchItems() {
  void queryClient.prefetchQuery({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: fetchAllItems,
    staleTime: POLL_INTERVAL_MS,
  });
}
