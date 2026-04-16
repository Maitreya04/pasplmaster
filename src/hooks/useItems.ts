import { useEffect, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '../lib/queryClient';
import type { Item } from '../types';

const BATCH_SIZE = 1000;
const ITEMS_SELECT =
  'id,name,alias,alias1,parent_group,main_group,item_category,sales_price,mrp,stock_qty,rack_no';

export async function fetchAllItems(): Promise<Item[]> {
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
  const uid = useId();

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingUpdates = new Map<number, Item>();
    let hasInvalidate = false;

    const applyUpdates = () => {
      queryClient.setQueryData<Item[]>(ITEMS_QUERY_KEY, (oldData) => {
        if (!oldData) return oldData;
        if (hasInvalidate) {
          void queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
          return oldData;
        }

        if (pendingUpdates.size === 0) return oldData;

        // Apply all updates in one go
        const newData = [...oldData];
        let changed = false;
        for (let i = 0; i < newData.length; i++) {
          const item = newData[i];
          const update = pendingUpdates.get(item.id);
          if (update) {
            newData[i] = { ...item, ...update };
            changed = true;
          }
        }

        pendingUpdates.clear();
        return changed ? newData : oldData;
      });
    };

    const channel = supabase
      .channel(`items-changes-${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'items' },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updatedItem = payload.new as Item;
            pendingUpdates.set(updatedItem.id, updatedItem);
          } else {
            hasInvalidate = true;
          }

          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            applyUpdates();
            hasInvalidate = false;
          }, 300); // 300ms batching window
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [uid]);

  return useQuery<Item[]>({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: fetchAllItems,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Fire-and-forget prefetch — call early so items are cached before user needs them. */
export function prefetchItems() {
  void queryClient.prefetchQuery({
    queryKey: ITEMS_QUERY_KEY,
    queryFn: fetchAllItems,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
