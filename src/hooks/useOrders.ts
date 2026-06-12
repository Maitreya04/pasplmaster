import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import {
  ORDERS_SELECT_WITH_ITEM_LINE_COUNT,
  normalizeOrderListBusyItemCount,
  type OrderRowWithEmbed,
} from '../lib/orderItemCount';
import { subscribeToTable } from '../lib/realtime';
import { isDirectTableRealtimeEnabled } from '../lib/realtimePolicy';
import type { Order, RejectionKind, WorkflowStatus } from '../types';

const DIRECT_TABLE_REALTIME_ON = isDirectTableRealtimeEnabled();

interface UseOrdersOptions {
  status?: WorkflowStatus;
  rejectionKind?: RejectionKind;
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
   * Override default keep-alive polling interval (ms). Realtime is the
   * primary update path; polling is only a safety net.
   */
  liveRefreshIntervalMs?: number;
  /**
   * Sort order for created_at.
   * - 'newest-first' (default) shows most recent orders at the top
   * - 'oldest-first' shows oldest orders at the top
   */
  sort?: 'newest-first' | 'oldest-first';
}

/**
 * Realtime is the primary update path; REST refetch is only a safety net.
 * Keep this slow while Realtime is healthy so list screens do not burn egress.
 */
const KEEPALIVE_INTERVAL_MS = 60_000;
const REALTIME_DEBOUNCE_MS = 750;

/** When Realtime is off, poll every 2s unless caller asked for a slower cadence (capped at 10s). */
function ordersRefetchIntervalMs(opts: UseOrdersOptions): number {
  if (DIRECT_TABLE_REALTIME_ON) return opts.liveRefreshIntervalMs ?? KEEPALIVE_INTERVAL_MS;
  if (opts.liveRefreshIntervalMs != null) {
    return Math.min(opts.liveRefreshIntervalMs, 10_000);
  }
  return 2_000;
}

function getTodayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function useOrders(options?: UseOrdersOptions | WorkflowStatus) {
  const opts: UseOrdersOptions =
    typeof options === 'string' ? { status: options } : options ?? {};

  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () =>
      [
        'orders',
        opts.status ?? 'all',
        opts.salespersonName ?? 'all',
        opts.todayOnly ?? false,
        opts.dateFrom ?? 'none',
        opts.dateTo ?? 'none',
        opts.overdueOnly ?? false,
        opts.limit ?? 'none',
        opts.sort ?? 'default',
        opts.liveRefreshIntervalMs ?? 'default',
        opts.rejectionKind ?? 'all',
      ] as const,
    [
      opts.status,
      opts.salespersonName,
      opts.todayOnly,
      opts.dateFrom,
      opts.dateTo,
      opts.overdueOnly,
      opts.limit,
      opts.sort,
      opts.liveRefreshIntervalMs,
      opts.rejectionKind,
    ],
  );

  const result = useQuery<Order[]>({
    queryKey,
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
      if (opts.rejectionKind) {
        q = q.eq('rejection_kind', opts.rejectionKind);
      }
      if (opts.salespersonName) {
        q = q.eq('salesperson_name', opts.salespersonName);
      }
      if (opts.todayOnly) {
        q = q.or(
          [
            `created_at.gte.${todayIso}`,
            `revived_at.gte.${todayIso}`,
            `approved_at.gte.${todayIso}`,
            `picked_at.gte.${todayIso}`,
            `completed_at.gte.${todayIso}`,
          ].join(','),
        );
      }
      if (opts.overdueOnly) {
        q = q
          .eq('workflow_status', 'submitted')
          .lt('created_at', todayIso)
          .or(`revived_at.is.null,revived_at.lt.${todayIso}`);
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
      return normalizeOrderListBusyItemCount((data ?? []) as OrderRowWithEmbed[]);
    },
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data !== undefined ? ordersRefetchIntervalMs(opts) : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  // Optional direct table Realtime. Production uses polling/event streams so
  // hot tables can stay out of the `supabase_realtime` publication.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!DIRECT_TABLE_REALTIME_ON) return;

    const scheduleInvalidate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void queryClient.invalidateQueries({ queryKey });
      }, REALTIME_DEBOUNCE_MS);
    };

    const ordersFilter =
      opts.status && !opts.overdueOnly
        ? `workflow_status=eq.${opts.status}`
        : undefined;

    const unsub = subscribeToTable({
      channelName: `orders-list:${queryKey.join('|')}`,
      table: 'orders',
      filter: ordersFilter,
      onChange: scheduleInvalidate,
      onReconnect: () => queryClient.invalidateQueries({ queryKey }),
    });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      unsub();
    };
  }, [queryClient, queryKey, opts.status, opts.overdueOnly]);

  return result;
}

/** Returns submitted orders created before today (overdue), sorted newest first by default */
export function useOverdueOrders() {
  return useOrders({ overdueOnly: true, sort: 'newest-first' });
}
