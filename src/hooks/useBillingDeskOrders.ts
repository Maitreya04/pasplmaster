import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClaimableOrders, type OrderWithClaimInfo } from './useClaimableOrders';
import { useDeskPickerFlags, type DeskPickerFlagLine } from './useDeskPickerFlags';
import { PICKING_CLAIM_STALE_MS } from './usePickingClaim';
import { supabase } from '../lib/supabase/client';
import type { WorkflowStatus } from '../types';

export type { DeskPickerFlagLine };

export type DeskOrderTab = 'all' | 'picking' | 'stale' | 'completed';

export type DeskOrderStatus =
  | 'picking'
  | 'checking'
  | 'no_ack'
  | 'unassigned'
  | 'submitted'
  | 'flagged';

export interface DeskOrderRow extends OrderWithClaimInfo {
  deskStatus: DeskOrderStatus;
  pickingClaimStale: boolean;
  /** Lines flagged by picker — present while picking or after pick completes with issues. */
  pickerFlags: DeskPickerFlagLine[];
}

export function orderNeedsDeskFlagAction(order: Pick<DeskOrderRow, 'deskStatus' | 'pickerFlags'>): boolean {
  return order.deskStatus === 'flagged' || order.pickerFlags.length > 0;
}

const MONITOR_STATUSES: WorkflowStatus[] = [
  'approved',
  'picking',
  'completed',
  'flagged',
];

export function deriveDeskOrderStatus(
  order: OrderWithClaimInfo,
  pickingClaimStale: boolean,
): DeskOrderStatus {
  if (order.workflow_status === 'flagged') return 'flagged';
  if (order.workflow_status === 'submitted') return 'submitted';
  if (order.workflow_status === 'picking') return 'picking';
  if (order.workflow_status === 'completed') return 'checking';
  if (order.workflow_status === 'approved') {
    if (!order.picker_name) return 'unassigned';
    if (pickingClaimStale) return 'no_ack';
    return 'no_ack';
  }
  return 'unassigned';
}

export function useBillingDeskOrders() {
  const { all, isLoading } = useClaimableOrders({
    stage: 'billing',
    todayOnly: true,
  });

  const monitorOrders = useMemo(
    () => (all ?? []).filter((o) => MONITOR_STATUSES.includes(o.workflow_status)),
    [all],
  );

  const pickingOrderIds = useMemo(
    () =>
      monitorOrders
        .filter((o) => o.workflow_status === 'picking' || o.workflow_status === 'approved')
        .map((o) => o.id),
    [monitorOrders],
  );

  const flagWatchOrderIds = useMemo(
    () =>
      monitorOrders
        .filter((o) => o.workflow_status === 'picking' || o.workflow_status === 'flagged')
        .map((o) => o.id),
    [monitorOrders],
  );

  const { data: pickerFlagsByOrder } = useDeskPickerFlags(flagWatchOrderIds);

  const { data: stalePickingIds } = useQuery({
    queryKey: ['billing-desk-picking-stale', pickingOrderIds.join(',')],
    enabled: pickingOrderIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_claims')
        .select('order_id, last_heartbeat_at')
        .in('order_id', pickingOrderIds)
        .eq('stage', 'picking')
        .eq('status', 'active');

      if (error) throw error;

      const now = Date.now();
      const stale = new Set<number>();
      for (const claim of data ?? []) {
        const age = now - new Date(claim.last_heartbeat_at).getTime();
        if (age > PICKING_CLAIM_STALE_MS) {
          stale.add(Number(claim.order_id));
        }
      }
      return stale;
    },
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const enriched = useMemo((): DeskOrderRow[] => {
    const staleSet = stalePickingIds ?? new Set<number>();
    const flagsMap = pickerFlagsByOrder ?? new Map<number, DeskPickerFlagLine[]>();
    return monitorOrders.map((order) => {
      const pickingClaimStale =
        order.workflow_status === 'picking' && staleSet.has(order.id);
      return {
        ...order,
        pickingClaimStale,
        pickerFlags: flagsMap.get(order.id) ?? [],
        deskStatus: deriveDeskOrderStatus(order, pickingClaimStale),
      };
    });
  }, [monitorOrders, stalePickingIds, pickerFlagsByOrder]);

  const flaggedOrders = useMemo(
    () => enriched.filter((o) => orderNeedsDeskFlagAction(o)),
    [enriched],
  );

  const listOrders = useMemo(
    () => enriched.filter((o) => !orderNeedsDeskFlagAction(o)),
    [enriched],
  );

  const staleCount = useMemo(
    () =>
      listOrders.filter(
        (o) =>
          o.pickingClaimStale ||
          o.deskStatus === 'no_ack' ||
          (o.claim_info?.is_stale ?? false),
      ).length,
    [listOrders],
  );

  const completedCount = useMemo(
    () => listOrders.filter((o) => o.deskStatus === 'checking').length,
    [listOrders],
  );

  return {
    isLoading,
    all: enriched,
    flaggedOrders,
    listOrders,
    staleCount,
    completedCount,
  };
}

const ACTIVE_PICK_STATUSES: DeskOrderStatus[] = ['unassigned', 'no_ack', 'picking'];

export function filterDeskOrdersByTab(
  orders: DeskOrderRow[],
  tab: DeskOrderTab,
): DeskOrderRow[] {
  if (tab === 'all') return orders;
  if (tab === 'picking') {
    return orders.filter((o) => ACTIVE_PICK_STATUSES.includes(o.deskStatus));
  }
  if (tab === 'completed') {
    return orders.filter((o) => o.deskStatus === 'checking');
  }
  return orders.filter(
    (o) =>
      o.pickingClaimStale ||
      o.deskStatus === 'no_ack' ||
      (o.claim_info?.is_stale ?? false),
  );
}
