import { useEffect, useMemo, useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '../lib/queryClient';
import { useAuth } from '../context/AuthContext';
import type { Order, ClaimStage, WorkflowStatus } from '../types';

/** Stale threshold in ms — matches the 3-minute heartbeat timeout */
const STALE_THRESHOLD_MS = 3 * 60 * 1000;
const LIVE_REFRESH_MS = 5_000;

interface ClaimableOrdersOptions {
  /** The stage to check claims for */
  stage: ClaimStage;
  /** Filter orders by workflow_status */
  workflowStatus?: WorkflowStatus | WorkflowStatus[];
  /** Only orders created today */
  todayOnly?: boolean;
}

interface ActiveClaimInfo {
  claim_id: number;
  claimed_by_user_id: number;
  claimed_by_name: string;
  claimed_at: string;
  last_heartbeat_at: string;
  is_stale: boolean;
}

export interface OrderWithClaimInfo extends Order {
  /** Null if no active claim, otherwise claim details */
  claim_info: ActiveClaimInfo | null;
  /** Is this order claimed by the current user? */
  is_mine: boolean;
}

interface UseClaimableOrdersReturn {
  /** Orders with no active claim — available to claim */
  available: OrderWithClaimInfo[];
  /** Orders claimed by the current user */
  myActive: OrderWithClaimInfo[];
  /** Orders claimed by someone else (fresh) */
  otherActive: OrderWithClaimInfo[];
  /** Orders with stale claims (heartbeat expired, can be taken over) */
  stale: OrderWithClaimInfo[];
  /** All orders combined */
  all: OrderWithClaimInfo[];
  /** Loading state */
  isLoading: boolean;
}

/**
 * Fetch orders enriched with active claim info for a given stage.
 * Subscribes to realtime changes on both orders and work_claims tables.
 */
export function useClaimableOrders(
  options: ClaimableOrdersOptions,
): UseClaimableOrdersReturn {
  const { userId } = useAuth();
  const uid = useId();
  const { stage, workflowStatus, todayOnly } = options;

  // Stable query key
  const statusKey = Array.isArray(workflowStatus)
    ? workflowStatus.join(',')
    : workflowStatus ?? 'all';

  const result = useQuery<OrderWithClaimInfo[]>({
    queryKey: ['claimable-orders', stage, statusKey, todayOnly ?? false],
    queryFn: async () => {
      // 1. Fetch orders
      let orderQuery = supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (workflowStatus) {
        if (Array.isArray(workflowStatus)) {
          orderQuery = orderQuery.in('workflow_status', workflowStatus);
        } else {
          orderQuery = orderQuery.eq('workflow_status', workflowStatus);
        }
      }

      if (todayOnly) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        orderQuery = orderQuery.gte('created_at', d.toISOString());
      }

      const { data: orders, error: orderError } = await orderQuery;
      if (orderError) throw orderError;
      if (!orders || orders.length === 0) return [];

      const orderIds = orders.map((o: Order) => o.id);

      // 2. Fetch active claims for these orders + stage, joined with user name
      const { data: claims, error: claimError } = await supabase
        .from('work_claims')
        .select('id, order_id, claimed_by_user_id, claimed_at, last_heartbeat_at, status, users!work_claims_claimed_by_user_id_fkey(full_name)')
        .in('order_id', orderIds)
        .eq('stage', stage)
        .eq('status', 'active');

      if (claimError) throw claimError;

      // Build a map: order_id → claim info
      const claimMap = new Map<number, ActiveClaimInfo>();
      const now = Date.now();

      for (const claim of claims ?? []) {
        const heartbeatAge = now - new Date(claim.last_heartbeat_at).getTime();
        const userRecord = claim.users as unknown as { full_name: string } | null;
        claimMap.set(claim.order_id, {
          claim_id: claim.id,
          claimed_by_user_id: claim.claimed_by_user_id,
          claimed_by_name: userRecord?.full_name ?? 'Unknown',
          claimed_at: claim.claimed_at,
          last_heartbeat_at: claim.last_heartbeat_at,
          is_stale: heartbeatAge > STALE_THRESHOLD_MS,
        });
      }

      // 3. Enrich orders
      return (orders as Order[]).map((order): OrderWithClaimInfo => {
        const claimInfo = claimMap.get(order.id) ?? null;
        return {
          ...order,
          claim_info: claimInfo,
          is_mine: claimInfo?.claimed_by_user_id === userId,
        };
      });
    },
    staleTime: 0, // Always refetch — claims change frequently
    refetchInterval: (query) => (query.state.data !== undefined ? LIVE_REFRESH_MS : false),
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  // Realtime: orders changes
  useEffect(() => {
    const channel = supabase
      .channel(`claimable-orders-${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_claims' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid]);

  // Categorize orders
  const categorized = useMemo(() => {
    const all = result.data ?? [];
    const available: OrderWithClaimInfo[] = [];
    const myActive: OrderWithClaimInfo[] = [];
    const otherActive: OrderWithClaimInfo[] = [];
    const stale: OrderWithClaimInfo[] = [];

    for (const order of all) {
      if (!order.claim_info) {
        available.push(order);
      } else if (order.is_mine) {
        myActive.push(order);
      } else if (order.claim_info.is_stale) {
        stale.push(order);
      } else {
        otherActive.push(order);
      }
    }

    return { available, myActive, otherActive, stale, all };
  }, [result.data]);

  return {
    ...categorized,
    isLoading: result.isLoading,
  };
}
