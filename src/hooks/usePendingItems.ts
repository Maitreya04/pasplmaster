import { useEffect, useId } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { PendingItem, PendingItemStatus, PendingRecoveryStatus } from '../types';

interface UsePendingItemsOptions {
  status?: PendingItemStatus;
  orderId?: number | null;
  customerId?: number;
  recoveryStatuses?: PendingRecoveryStatus[];
  enabled?: boolean;
}

export function usePendingItems(options?: UsePendingItemsOptions) {
  const opts = options ?? {};
  const enabled = opts.enabled ?? true;
  const queryClient = useQueryClient();
  const channelId = useId();

  return useQuery<PendingItem[]>({
    queryKey: [
      'pending-items',
      opts.status ?? 'all',
      opts.orderId ?? 'all',
      opts.customerId ?? 'all',
      opts.recoveryStatuses?.join(',') ?? 'all',
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
      if (opts.recoveryStatuses?.length) {
        q = q.in('recovery_status', opts.recoveryStatuses);
      }

      const { data, error } = await q.returns<PendingItem[]>();
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 0,
    enabled,
    refetchInterval: 30000,
  });
}

