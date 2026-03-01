import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { Order, OrderStatus } from '../types';

export function useOrders(status?: OrderStatus) {
  return useQuery<Order[]>({
    queryKey: ['orders', status ?? 'all'],
    queryFn: async () => {
      let query = supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Order[];
    },
    staleTime: 0,
  });
}
