import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { computePickLineProgress, type PickLineProgress } from '../lib/cartSupply';

type OrderItemPickRow = {
  order_id: number;
  state: string | null;
  qty_requested: number | null;
  qty_shippable: number | null;
  qty_po: number | null;
  qty_approved: number | null;
};

export function useDeskPickProgress(orderIds: number[]) {
  const sortedKey = useMemo(
    () => [...orderIds].sort((a, b) => a - b).join(','),
    [orderIds],
  );

  return useQuery({
    queryKey: ['desk-pick-progress', sortedKey],
    enabled: orderIds.length > 0,
    queryFn: async (): Promise<Map<number, PickLineProgress>> => {
      const { data, error } = await supabase
        .from('order_items')
        .select('order_id, state, qty_requested, qty_shippable, qty_po, qty_approved')
        .in('order_id', orderIds);

      if (error) throw error;

      const grouped = new Map<number, OrderItemPickRow[]>();
      for (const row of (data ?? []) as OrderItemPickRow[]) {
        const oid = Number(row.order_id);
        const list = grouped.get(oid) ?? [];
        list.push(row);
        grouped.set(oid, list);
      }

      const result = new Map<number, PickLineProgress>();
      for (const [orderId, items] of grouped) {
        result.set(
          orderId,
          computePickLineProgress(
            items.map((item) => ({
              state: item.state,
              qty_requested: item.qty_requested ?? 0,
              qty_shippable: item.qty_shippable,
              qty_po: item.qty_po,
              qty_approved: item.qty_approved,
            })),
          ),
        );
      }
      return result;
    },
    staleTime: 5_000,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
}
