import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { Customer } from '../types';

export function useCustomers() {
  return useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;
      return data as Customer[];
    },
    staleTime: 30 * 60 * 1000,
  });
}
