import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '../lib/queryClient';
import type { Item } from '../types';

const BATCH_SIZE = 1000;
const ITEMS_SELECT =
  'id,name,alias,alias1,parent_group,main_group,item_category,sales_price,mrp,stock_qty,rack_no';

/** How often to poll for changes (ms). Your MSSQL script runs every ~70s, so 30s polling
 *  means at most a 30-second lag before the UI catches up. */
const POLL_INTERVAL_MS = 30_000;

export async function fetchAllItems(): Promise<Item[]> {
  console.log('[useItems] fetching all items...', new Date().toLocaleTimeString());
  const { count, error: countErr } = await supabase
    .from('items')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  if (countErr) throw countErr;
  if (!count) return [];

  const batches = Math.ceil(count / BATCH_SIZE);
  const promises = Array.from({ length: batches }, (_, i) => {
    const from = i * BATCH_SIZE;
    return supabase
      .from('items')
      .select(ITEMS_SELECT)
      .eq('is_active', true)
      .range(from, from + BATCH_SIZE - 1)
      .order('id');
  });

  const results = await Promise.all(promises);
  const allItems: Item[] = new Array(count);
  let offset = 0;
  for (const { data, error } of results) {
    if (error) throw error;
    if (data) {
      for (let i = 0; i < data.length; i++) allItems[offset + i] = data[i];
      offset += data.length;
    }
  }
  const final = allItems.slice(0, offset);
  console.log('[useItems] fetched', final.length, 'items. Sample stock_qty:', final[0]?.stock_qty);
  return final;
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
