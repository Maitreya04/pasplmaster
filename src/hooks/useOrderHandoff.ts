import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import {
  mergeOrderHandoffSummary,
  type OrderHandoffFallback,
  type OrderHandoffSummary,
} from '../lib/billing/orderHandoffFromEvents';

export function useOrderHandoff(
  orderId: number | null | undefined,
  enabled: boolean,
  fallback?: OrderHandoffFallback,
) {
  return useQuery<OrderHandoffSummary | null>({
    queryKey: ['order-handoff', orderId],
    enabled: Boolean(orderId) && enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!orderId) return null;

      const { data, error } = await supabase.rpc('get_order_handoff_summary', {
        p_order_id: orderId,
      });

      if (error) throw error;
      return mergeOrderHandoffSummary(data, fallback);
    },
  });
}
