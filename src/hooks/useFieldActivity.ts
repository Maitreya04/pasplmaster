import { useQuery } from '@tanstack/react-query';
import {
  fetchFieldActivityDashboard,
  fetchSalespersonVisitRoute,
} from '../lib/visit/visitService';

export function useFieldActivityDashboard(date: string) {
  return useQuery({
    queryKey: ['admin', 'fieldActivity', date],
    queryFn: () => fetchFieldActivityDashboard(date),
    staleTime: 30_000,
  });
}

export function useSalespersonVisitRoute(salesmanUserId: number | null, date: string) {
  return useQuery({
    queryKey: ['admin', 'visitRoute', salesmanUserId, date],
    queryFn: () => fetchSalespersonVisitRoute(salesmanUserId!, date),
    enabled: salesmanUserId != null,
  });
}
