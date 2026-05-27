import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { matchesPartnerBrandGroups } from '../lib/purchase/partnerBrandMatch';
import type { PendingItem, PendingItemStatus, PendingRecoveryStatus } from '../types';

interface UsePendingItemsOptions {
  status?: PendingItemStatus;
  orderId?: number | null;
  customerId?: number;
  recoveryStatuses?: PendingRecoveryStatus[];
  brandKeys?: string[];
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
      opts.recoveryStatuses?.join(',') ?? 'all',
      opts.brandKeys?.join(',') ?? 'all',
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
      let rows = data ?? [];

      if (opts.brandKeys?.length) {
        const itemIds = [
          ...new Set(
            rows
              .map((item) => item.item_id)
              .filter((id): id is number => typeof id === 'number'),
          ),
        ];
        if (itemIds.length === 0) return [];

        const { data: itemRows, error: itemError } = await supabase
          .from('items')
          .select('id, main_group, parent_group')
          .in('id', itemIds);
        if (itemError) throw itemError;

        const groupsById = new Map(
          (itemRows ?? []).map((row) => [
            row.id as number,
            {
              main_group: row.main_group as string | null,
              parent_group: row.parent_group as string | null,
            },
          ]),
        );

        rows = rows.filter((item) => {
          if (item.item_id == null) return false;
          const groups = groupsById.get(item.item_id);
          if (!groups) return false;
          return matchesPartnerBrandGroups(
            groups.main_group,
            groups.parent_group,
            opts.brandKeys,
          );
        });
      }

      return rows;
    },
    staleTime: 0,
    enabled,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
  });
}

