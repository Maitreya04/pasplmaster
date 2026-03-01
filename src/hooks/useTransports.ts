import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { Transport } from '../types';

export function useTransports() {
  return useQuery<Transport[]>({
    queryKey: ['transports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transports')
        .select('*')
        .eq('is_active', true);

      if (error) throw error;
      return data as Transport[];
    },
    staleTime: 60 * 60 * 1000,
  });
}
