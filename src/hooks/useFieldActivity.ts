import { useQuery } from '@tanstack/react-query';
import { fetchFieldActivityDashboard } from '../lib/visit/visitService';

export function useFieldActivityDashboard(date: string) {
  return useQuery({
    queryKey: ['admin', 'fieldActivity', date],
    queryFn: () => fetchFieldActivityDashboard(date),
    staleTime: 30_000,
  });
}
