import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { BillingCustomerUpdate } from '../types';

interface UseBillingCustomerUpdateOptions {
  orderId: number | null;
  enabled?: boolean;
}

export function useBillingCustomerUpdate(options: UseBillingCustomerUpdateOptions) {
  const enabled = options.enabled ?? true;

  return useQuery<BillingCustomerUpdate | null>({
    queryKey: ['billing-customer-update', options.orderId ?? 'none'],
    queryFn: async () => {
      if (typeof options.orderId !== 'number') return null;

      const { data, error } = await supabase
        .from('billing_customer_updates')
        .select('*')
        .eq('order_id', options.orderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return (data as BillingCustomerUpdate | null) ?? null;
    },
    staleTime: 0,
    enabled: enabled && typeof options.orderId === 'number',
  });
}
