import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import {
  endWorkday,
  fetchActiveVisit,
  fetchTodayWorkday,
  startWorkday,
} from '../lib/visit/visitService';
import type { ActiveVisit, WorkdayState } from '../types/visit';

const WORKDAY_KEY = ['sales', 'workday'] as const;
const ACTIVE_VISIT_KEY = ['sales', 'activeVisit'] as const;

export function useWorkday() {
  const { userId, role } = useAuth();
  const queryClient = useQueryClient();
  const enabled = role === 'sales' && userId != null;

  const query = useQuery({
    queryKey: [...WORKDAY_KEY, userId],
    queryFn: () => fetchTodayWorkday(userId),
    enabled,
    refetchInterval: 60_000,
  });

  const startMutation = useMutation({
    mutationFn: async (coords?: { lat: number; lng: number }) =>
      startWorkday(userId, coords?.lat, coords?.lng),
    onSuccess: (workday) => {
      queryClient.setQueryData([...WORKDAY_KEY, userId], workday satisfies WorkdayState);
    },
  });

  const endMutation = useMutation({
    mutationFn: () => endWorkday(userId),
    onSuccess: (workday) => {
      queryClient.setQueryData([...WORKDAY_KEY, userId], workday satisfies WorkdayState);
    },
  });

  return {
    workday: query.data ?? { active: false },
    isLoading: query.isLoading,
    refetch: query.refetch,
    startWorkday: startMutation.mutateAsync,
    endWorkday: endMutation.mutateAsync,
    isStarting: startMutation.isPending,
    isEnding: endMutation.isPending,
  };
}

export function useActiveVisit() {
  const { userId, role } = useAuth();
  const queryClient = useQueryClient();
  const enabled = role === 'sales' && userId != null;

  const query = useQuery({
    queryKey: [...ACTIVE_VISIT_KEY, userId],
    queryFn: () => fetchActiveVisit(userId),
    enabled,
    refetchInterval: 30_000,
  });

  const setActiveVisit = (visit: ActiveVisit | null) => {
    queryClient.setQueryData([...ACTIVE_VISIT_KEY, userId], visit);
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: [...ACTIVE_VISIT_KEY, userId] });
    void queryClient.invalidateQueries({ queryKey: [...WORKDAY_KEY, userId] });
  };

  return {
    activeVisit: query.data ?? null,
    isLoading: query.isLoading,
    refetch: query.refetch,
    setActiveVisit,
    invalidate,
  };
}
