import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { PendingItem, PendingItemStatus } from '../types';

interface UsePendingItemsOptions {
  status?: PendingItemStatus;
  orderId?: number | null;
  customerId?: number;
  enabled?: boolean;
}

export function usePendingItems(options?: UsePendingItemsOptions) {
  const opts = options ?? {};
  const enabled = opts.enabled ?? true;

  return useQuery<PendingItem[]>({
    queryKey: [
      'pending-items',
      opts.status ?? 'all',
      opts.orderId ?? 'all',
      opts.customerId ?? 'all',
    ],
    queryFn: async () => {
      let q = supabase.from('pending_items').select('*').order('created_at', {
        ascending: false,
      });

      if (opts.status) {
        q = q.eq('status', opts.status);
      }
      if (typeof opts.orderId === 'number') {
        q = q.eq('order_id', opts.orderId);
      }
      if (opts.customerId) {
        q = q.eq('customer_id', opts.customerId);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data as PendingItem[];
    },
    staleTime: 0,
    enabled,
  });
}


