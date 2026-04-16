import { useEffect, useId } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { PendingItem, WorkflowStatus } from '../types';

type PendingRecoveryRow = PendingItem & {
  items?: { stock_qty: number | null } | { stock_qty: number | null }[] | null;
  orders?: {
    salesperson_name: string | null;
    workflow_status: WorkflowStatus | null;
  } | Array<{
    salesperson_name: string | null;
    workflow_status: WorkflowStatus | null;
  }> | null;
};

export interface SalesPendingRecoveryItem extends PendingItem {
  stock_qty: number | null;
  salesperson_name: string | null;
  order_workflow_status: WorkflowStatus | null;
}

function normalizeRow(row: PendingRecoveryRow): SalesPendingRecoveryItem {
  const itemJoin = Array.isArray(row.items) ? row.items[0] : row.items;
  const orderJoin = Array.isArray(row.orders) ? row.orders[0] : row.orders;

  return {
    ...row,
    stock_qty: itemJoin?.stock_qty ?? null,
    salesperson_name: orderJoin?.salesperson_name ?? null,
    order_workflow_status: orderJoin?.workflow_status ?? null,
  };
}

export function useSalesPendingRecovery(userName: string | null) {
  const queryClient = useQueryClient();
  const channelId = useId();

  useEffect(() => {
    if (!userName) return;

    const channel = supabase
      .channel(`sales-pending-recovery-${channelId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pending_items',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['sales-pending-recovery'] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelId, queryClient, userName]);

  return useQuery<SalesPendingRecoveryItem[]>({
    queryKey: ['sales-pending-recovery', userName ?? 'unknown'],
    queryFn: async () => {
      if (!userName) return [];

      const { data, error } = await supabase
        .from('pending_items')
        .select(
          `
          *,
          items ( stock_qty ),
          orders!inner (
            salesperson_name,
            workflow_status
          )
        `,
        )
        .eq('status', 'pending')
        .neq('recovery_status', 'reviewed')
        .eq('orders.salesperson_name', userName)
        .order('created_at', { ascending: false })
        .returns<PendingRecoveryRow[]>();

      if (error) throw error;
      return (data ?? []).map(normalizeRow);
    },
    enabled: !!userName,
    staleTime: 0,
  });
}
