import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';

export interface DeskPickerFlagLine {
  orderItemId: number;
  itemName: string;
  flagReason: string | null;
}

export function useDeskPickerFlags(orderIds: number[]) {
  const sortedKey = useMemo(
    () => [...orderIds].sort((a, b) => a - b).join(','),
    [orderIds],
  );

  return useQuery({
    queryKey: ['desk-picker-flags', sortedKey],
    enabled: orderIds.length > 0,
    queryFn: async (): Promise<Map<number, DeskPickerFlagLine[]>> => {
      const { data, error } = await supabase
        .from('order_items')
        .select('id, order_id, item_name, flag_reason')
        .in('order_id', orderIds)
        .eq('state', 'flagged');

      if (error) throw error;

      const grouped = new Map<number, DeskPickerFlagLine[]>();
      for (const row of data ?? []) {
        const orderId = Number(row.order_id);
        const list = grouped.get(orderId) ?? [];
        list.push({
          orderItemId: Number(row.id),
          itemName: row.item_name ?? 'Item',
          flagReason: row.flag_reason ?? null,
        });
        grouped.set(orderId, list);
      }
      return grouped;
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}
