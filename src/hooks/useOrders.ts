import { useEffect, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '../lib/queryClient';
import type { Order, OrderStatus } from '../types';

interface UseOrdersOptions {
  status?: OrderStatus;
  salespersonName?: string | null;
  /** Filter to orders created today (default: false) */
  todayOnly?: boolean;
  /** Filter created_at >= dateFrom (ISO string) */
  dateFrom?: string;
  /** Filter created_at <= dateTo (ISO string) */
  dateTo?: string;
  /** Only submitted orders created before today (overdue) */
  overdueOnly?: boolean;
  /** Max number of orders to fetch (for History pagination) */
  limit?: number;
  /**
   * Sort order for created_at.
   * - 'newest-first' (default) shows most recent orders at the top
   * - 'oldest-first' shows oldest orders at the top
   */
  sort?: 'newest-first' | 'oldest-first';
}

function getTodayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function useOrders(options?: UseOrdersOptions | OrderStatus) {
  const opts: UseOrdersOptions =
    typeof options === 'string' ? { status: options } : options ?? {};
  const uid = useId();

  const result = useQuery<Order[]>({
    queryKey: [
      'orders',
      opts.status ?? 'all',
      opts.salespersonName ?? 'all',
      opts.todayOnly ?? false,
      opts.dateFrom ?? 'none',
      opts.dateTo ?? 'none',
      opts.overdueOnly ?? false,
      opts.limit ?? 'none',
      opts.sort ?? 'default',
    ],
    queryFn: async () => {
      const todayIso = getTodayStartIso();

      const sort = opts.sort ?? 'newest-first';
      const orderAsc = sort === 'oldest-first';
      let q = supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: orderAsc });

      if (opts.status && !opts.overdueOnly) {
        q = q.eq('status', opts.status);
      }
      if (opts.salespersonName) {
        q = q.eq('salesperson_name', opts.salespersonName);
      }
      if (opts.todayOnly) {
        q = q.gte('created_at', todayIso);
      }
      if (opts.overdueOnly) {
        q = q.eq('status', 'submitted').lt('created_at', todayIso);
      }
      if (opts.dateFrom) {
        q = q.gte('created_at', opts.dateFrom);
      }
      if (opts.dateTo) {
        q = q.lte('created_at', opts.dateTo);
      }
      if (opts.limit) {
        q = q.limit(opts.limit);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data as Order[];
    },
    staleTime: 0,
  });

  // Realtime subscription: invalidate orders when table changes.
  // Each hook instance gets a unique channel name to avoid collisions when
  // multiple useOrders calls are active on the same page.
  useEffect(() => {
    const channel = supabase
      .channel(`orders-changes-${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['orders'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid]);

  return result;
}

/** Returns submitted orders created before today (overdue), sorted newest first by default */
export function useOverdueOrders() {
  return useOrders({ overdueOnly: true, sort: 'newest-first' });
}
