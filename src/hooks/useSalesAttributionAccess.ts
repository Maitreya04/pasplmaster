import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';

export function useSalesAttributionAccess(enabled: boolean) {
  return useQuery({
    queryKey: ['sales-attribution-access'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('has_my_sales_attribution');
      if (error) throw error;
      return data === true;
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
