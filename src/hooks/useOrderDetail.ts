import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { OrderWithItems } from '../types';

export function useOrderDetail(orderId: number | null) {
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
