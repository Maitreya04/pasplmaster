import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { useTeamUsers } from './useTeamUsers';

const MAX_PICKER_LOAD = 5;

export interface PickerLoadInfo {
  userId: number;
  name: string;
  firstName: string;
  activeOrders: number;
  loadPct: number;
  isBusy: boolean;
  initials: string;
  colorIndex: number;
}

const PICKER_COLORS = [
  { bg: 'var(--indigo-1)', text: 'var(--indigo-8)' },
  { bg: 'color-mix(in srgb, var(--amber-3) 40%, white)', text: 'var(--amber-8)' },
  { bg: 'color-mix(in srgb, var(--green-2) 50%, white)', text: 'var(--green-8)' },
  { bg: 'color-mix(in srgb, var(--red-2) 40%, white)', text: 'var(--red-7)' },
  { bg: 'color-mix(in srgb, var(--blue-2) 50%, white)', text: 'var(--blue-8)' },
  { bg: 'color-mix(in srgb, var(--indigo-3) 40%, white)', text: 'var(--indigo-9)' },
];

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}

export function usePickerLoad() {
  const { data: pickers = [], isLoading: usersLoading } = useTeamUsers('picking');

  const { data: loadByUserId, isLoading: loadLoading } = useQuery({
    queryKey: ['picker-load-counts'],
    queryFn: async () => {
      const { data: claims, error } = await supabase
        .from('work_claims')
        .select('claimed_by_user_id, order_id')
        .eq('stage', 'picking')
        .eq('status', 'active');

      if (error) throw error;
      if (!claims?.length) return new Map<number, number>();

      const orderIds = [...new Set(claims.map((row) => Number(row.order_id)))];
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id')
        .in('id', orderIds)
        .in('workflow_status', ['approved', 'picking']);

      if (ordersError) throw ordersError;

      const openPickOrderIds = new Set((orders ?? []).map((row) => Number(row.id)));
      const counts = new Map<number, number>();
      for (const row of claims) {
        if (!openPickOrderIds.has(Number(row.order_id))) continue;
        const uid = Number(row.claimed_by_user_id);
        counts.set(uid, (counts.get(uid) ?? 0) + 1);
      }
      return counts;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const pickersWithLoad = useMemo((): PickerLoadInfo[] => {
    return pickers.map((user, index) => {
      const activeOrders = loadByUserId?.get(user.id) ?? 0;
      const loadPct = Math.min(100, Math.round((activeOrders / MAX_PICKER_LOAD) * 100));
      return {
        userId: user.id,
        name: user.full_name,
        firstName: firstName(user.full_name),
        activeOrders,
        loadPct,
        isBusy: activeOrders >= MAX_PICKER_LOAD,
        initials: initials(user.full_name),
        colorIndex: index % PICKER_COLORS.length,
      };
    });
  }, [pickers, loadByUserId]);

  return {
    pickers: pickersWithLoad,
    colors: PICKER_COLORS,
    isLoading: usersLoading || loadLoading,
  };
}

export function pickerLoadBarColor(loadPct: number): string {
  if (loadPct <= 30) return 'var(--bg-positive)';
  if (loadPct <= 70) return 'var(--bg-warning)';
  return 'var(--bg-negative)';
}
