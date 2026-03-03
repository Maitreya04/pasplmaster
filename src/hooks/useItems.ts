import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '../lib/queryClient';
import type { Item } from '../types';

const BATCH_SIZE = 1000;
const ITEMS_SELECT =
  'id,name,alias,alias1,parent_group,main_group,item_category,sales_price,mrp,stock_qty,rack_no';

async function fetchAllItems(): Promise<Item[]> {
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
  return allItems.slice(0, offset);
}

export const ITEMS_QUERY_KEY = ['items'] as const;

export function useItems() {
  return useQuery<Item[]>({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: fetchAllItems,
    staleTime: 30 * 60 * 1000,
  });
}

/** Fire-and-forget prefetch — call early so items are cached before user needs them. */
export function prefetchItems() {
  void queryClient.prefetchQuery({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: fetchAllItems,
    staleTime: 30 * 60 * 1000,
  });
}
