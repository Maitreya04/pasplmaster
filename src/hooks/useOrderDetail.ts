import { useEffect, useId } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { OrderWithItems } from '../types';

export function useOrderDetail(orderId: number | null) {
  const queryClient = useQueryClient();
  const uid = useId();

  useEffect(() => {
    if (orderId === null) return;

    const channel = supabase
      .channel(`order-items-${orderId}-${uid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_items',
          filter: `order_id=eq.${orderId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId, uid, queryClient]);

  return useQuery<OrderWithItems>({
    queryKey: ['order', orderId],
    queryFn: async () => {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId!)
        .single();

      if (orderError) throw orderError;

      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId!);

      if (itemsError) throw itemsError;

      return { ...order, items } as OrderWithItems;
    },
    enabled: orderId !== null,
    staleTime: 0,
  });
}
