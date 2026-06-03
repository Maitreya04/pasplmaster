import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useClaimableOrders, type OrderWithClaimInfo } from './useClaimableOrders';
import { useDeskPickerFlags } from './useDeskPickerFlags';
import type { DeskPickerFlagLine } from '../lib/billing/deskOrderQueue';
import { PICKING_CLAIM_STALE_MS } from './usePickingClaim';
import { supabase } from '../lib/supabase/client';
import { isDeskBillingFinalized } from '../lib/billing/deskOrderTab';
import { deriveDeskOrderStatus } from '../lib/billing/deriveDeskOrderStatus';
import {
  isAssignTabOrder,
  orderBelongsOnDeskResolveTab,
  isPickingTabOrder,
  type DeskOrderStatus,
  type DeskOrderTab,
} from '../lib/billing/deskOrderQueue';

export { deriveDeskOrderStatus } from '../lib/billing/deriveDeskOrderStatus';
export type { DeskOrderStatusOptions } from '../lib/billing/deriveDeskOrderStatus';
import type { WorkflowStatus } from '../types';

export type { DeskPickerFlagLine } from '../lib/billing/deskOrderQueue';
export type { DeskOrderTab, DeskOrderStatus };
export {
  filterDeskOrdersByTab,
  isDeskOrderStale,
  isPickingTabOrder,
  orderBelongsOnDeskResolveTab,
  orderHasDeskPickerFlags,
} from '../lib/billing/deskOrderQueue';

export interface DeskOrderRow extends OrderWithClaimInfo {
  deskStatus: DeskOrderStatus;
  pickingClaimStale: boolean;
  /** Lines flagged by picker — present while picking or after pick completes with issues. */
  pickerFlags: DeskPickerFlagLine[];
}

const MONITOR_STATUSES: WorkflowStatus[] = [
  'approved',
  'picking',
  'completed',
  'flagged',
];

export function useBillingDeskOrders() {
  const { all: activePipeline, isLoading: activeLoading } = useClaimableOrders({
    stage: 'billing',
    workflowStatus: ['approved', 'picking', 'flagged'],
  });

  const { all: completedToday, isLoading: completedLoading } = useClaimableOrders({
    stage: 'billing',
    workflowStatus: 'completed',
    completedTodayOnly: true,
  });

  const monitorOrders = useMemo(
    () =>
      [...(activePipeline ?? []), ...(completedToday ?? [])].filter((o) =>
        MONITOR_STATUSES.includes(o.workflow_status),
      ),
    [activePipeline, completedToday],
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
        .filter(
          (o) =>
            o.workflow_status === 'picking' ||
            o.workflow_status === 'flagged' ||
            o.workflow_status === 'completed',
        )
        .map((o) => o.id),
    [monitorOrders],
  );

  const { data: pickerFlagsByOrder } = useDeskPickerFlags(flagWatchOrderIds);

  const { data: pickingClaims } = useQuery({
    queryKey: ['billing-desk-picking-claims', pickingOrderIds.join(',')],
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
      const active = new Set<number>();
      for (const claim of data ?? []) {
        const orderId = Number(claim.order_id);
        const age = now - new Date(claim.last_heartbeat_at).getTime();
        if (age > PICKING_CLAIM_STALE_MS) {
          stale.add(orderId);
        } else {
          active.add(orderId);
        }
      }
      return { stale, active };
    },
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const enriched = useMemo((): DeskOrderRow[] => {
    const staleSet = pickingClaims?.stale ?? new Set<number>();
    const activeSet = pickingClaims?.active ?? new Set<number>();
    const flagsMap = pickerFlagsByOrder ?? new Map<number, DeskPickerFlagLine[]>();
    return monitorOrders.map((order) => {
      const pickingClaimStale =
        order.workflow_status === 'picking' && staleSet.has(order.id);
      const hasActivePickingClaim = activeSet.has(order.id);
      return {
        ...order,
        pickingClaimStale,
        pickerFlags: flagsMap.get(order.id) ?? [],
        deskStatus: deriveDeskOrderStatus(order, {
          pickingClaimStale,
          hasActivePickingClaim,
        }),
      };
    });
  }, [monitorOrders, pickingClaims, pickerFlagsByOrder]);

  const resolveOrders = useMemo(
    () => enriched.filter((o) => orderBelongsOnDeskResolveTab(o)),
    [enriched],
  );

  const listOrders = enriched;

  const resolveCount = resolveOrders.length;

  const assignCount = useMemo(
    () => listOrders.filter(isAssignTabOrder).length,
    [listOrders],
  );

  const pickingCount = useMemo(
    () => listOrders.filter(isPickingTabOrder).length,
    [listOrders],
  );

  const completedCount = useMemo(
    () =>
      listOrders.filter(
        (o) => !orderBelongsOnDeskResolveTab(o) && isDeskBillingFinalized(o),
      ).length,
    [listOrders],
  );

  return {
    isLoading: activeLoading || completedLoading,
    all: enriched,
    flaggedOrders: resolveOrders,
    listOrders,
    resolveCount,
    assignCount,
    pickingCount,
    completedCount,
  };
}
