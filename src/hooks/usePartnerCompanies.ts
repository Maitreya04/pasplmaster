import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { PartnerCompany } from '../types';

export function usePartnerCompanies() {
  return useQuery<PartnerCompany[]>({
    queryKey: ['partner-companies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partner_companies')
        .select('*')
        .eq('is_active', true)
        .order('display_name')
        .returns<PartnerCompany[]>();
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}
