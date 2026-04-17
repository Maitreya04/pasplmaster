import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '../lib/queryClient';
import type { Item } from '../types';


const ITEMS_SELECT =
  'id,name,alias,alias1,parent_group,main_group,item_category,sales_price,mrp,stock_qty,rack_no';

/** How often to poll for changes (ms). Your MSSQL script runs every ~70s, so 30s polling
 *  means at most a 30-second lag before the UI catches up. */
const POLL_INTERVAL_MS = 30_000;

let lastSyncTime: string | null = null;
let cachedItems: Map<number, Item> = new Map();
let isFirstFetch = true;
let lastReturnedArray: Item[] = [];

export async function fetchAllItems(): Promise<Item[]> {
  // console.log('[useItems] polling... isFirstFetch:', isFirstFetch, 'lastSyncTime:', lastSyncTime);

  let hasChanges = false;

  if (isFirstFetch || !lastSyncTime) {
    let allFetched = false;
    let lastId = 0;
    let localMaxDate = '1970-01-01T00:00:00Z';
    
    // Clear cache in case of forced refetch
    cachedItems.clear();

    while (!allFetched) {
      const { data: rawData, error } = await supabase
        .from('items')
        .select(ITEMS_SELECT + ',updated_at,is_active')
        .eq('is_active', true)
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(1000);

      const data = rawData as any as (Item & { updated_at: string })[];

      if (error) throw error;
      if (!data || data.length === 0) {
        allFetched = true;
        break;
      }

      hasChanges = true;
      for (const item of data) {
        cachedItems.set(item.id, item);
        if (item.updated_at && item.updated_at > localMaxDate) localMaxDate = item.updated_at;
        lastId = item.id;
      }
      
      if (data.length < 1000) {
        allFetched = true;
      }
    }

    lastSyncTime = localMaxDate;
    isFirstFetch = false;
  } else {
    // Delta fetch
    let allFetched = false;
    let lastId = 0;
    let localMaxDate = lastSyncTime;

    while (!allFetched) {
      const { data: rawData, error } = await supabase
        .from('items')
        .select(ITEMS_SELECT + ',updated_at,is_active')
        .gt('updated_at', lastSyncTime)
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(1000);

      const data = rawData as any as (Item & { updated_at: string })[];

      if (error) throw error;
      if (!data || data.length === 0) {
        allFetched = true;
        break;
      }

      hasChanges = true;
      for (const item of data) {
        if (item.is_active === false) {
          cachedItems.delete(item.id);
        } else {
          cachedItems.set(item.id, item);
        }
        if (item.updated_at && item.updated_at > localMaxDate) localMaxDate = item.updated_at;
        lastId = item.id;
      }
      
      if (data.length < 1000) {
        allFetched = true;
      }
    }

    if (hasChanges) {
      lastSyncTime = localMaxDate;
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
