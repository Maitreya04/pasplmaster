import { useEffect, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '../lib/queryClient';
import type { Order, WorkflowStatus } from '../types';
import {
  ORDERS_SELECT_WITH_ITEM_LINE_COUNT,
  normalizeOrderBusyItemCount,
  type OrderRowWithEmbed,
} from '../lib/orderItemCount';

interface UseOrdersOptions {
  status?: WorkflowStatus;
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

const LIVE_REFRESH_MS = 5_000;

function getTodayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function useOrders(options?: UseOrdersOptions | WorkflowStatus) {
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
        .select(ORDERS_SELECT_WITH_ITEM_LINE_COUNT)
        .order('created_at', { ascending: orderAsc });

      if (opts.status && !opts.overdueOnly) {
        q = q.eq('workflow_status', opts.status);
      }
      if (opts.salespersonName) {
        q = q.eq('salesperson_name', opts.salespersonName);
      }
      if (opts.todayOnly) {
        q = q.gte('created_at', todayIso);
      }
      if (opts.overdueOnly) {
        q = q.eq('workflow_status', 'submitted').lt('created_at', todayIso);
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
      return (data ?? []).map((row) =>
        normalizeOrderBusyItemCount(row as OrderRowWithEmbed),
      );
    },
    staleTime: 0,
    refetchInterval: (query) => (query.state.data !== undefined ? LIVE_REFRESH_MS : false),
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  return result;
}

/** Returns submitted orders created before today (overdue), sorted newest first by default */
export function useOverdueOrders() {
  return useOrders({ overdueOnly: true, sort: 'newest-first' });
}
