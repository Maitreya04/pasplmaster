import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { getCustomerAddress } from '../lib/customerDisplay';
import { queryClient } from '../lib/queryClient';
import { useAuth } from '../context/AuthContext';
import {
  ORDERS_SELECT_WITH_ITEM_LINE_COUNT,
  normalizeOrderListBusyItemCount,
  type OrderItemsPreview,
  type OrderRowWithEmbed,
} from '../lib/orderItemCount';
import { subscribeToTable } from '../lib/realtime';
import {
  isBillingQueueEventsEnabled,
  isDirectTableRealtimeEnabled,
  isSupabasePostgresChangesEnabled,
} from '../lib/realtimePolicy';
import { isPickQueueEligibleForBranch } from '../lib/picking/pickQueueEligibility';
import type {
  FulfillmentPath,
  Order,
  ClaimStage,
  StockLocationCode,
  WorkflowStatus,
} from '../types';

const REALTIME_ON = isSupabasePostgresChangesEnabled();
const QUEUE_EVENTS_ON = isBillingQueueEventsEnabled();
const DIRECT_TABLE_REALTIME_ON = isDirectTableRealtimeEnabled();

/** Stale threshold in ms — matches the 3-minute heartbeat timeout */
const STALE_THRESHOLD_MS = 3 * 60 * 1000;

/**
 * Queue events are primary. Direct table Realtime is opt-in and keeps the old
 * short keep-alive cadence; queue events use a slow safety poll.
 */
const KEEPALIVE_INTERVAL_MS = 5_000;
const BILLING_EVENT_CONNECTED_KEEPALIVE_INTERVAL_MS = 60_000;
const BILLING_EVENT_DEGRADED_KEEPALIVE_INTERVAL_MS = 5_000;
const POLL_NO_REALTIME_MS = 2_000;

/** Coalesce realtime bursts into a single refetch. */
const REALTIME_DEBOUNCE_MS = 750;

interface ClaimableOrdersOptions {
  /** The stage to check claims for */
  stage: ClaimStage;
  /** Filter orders by workflow_status */
  workflowStatus?: WorkflowStatus | WorkflowStatus[];
  /**
   * Billing desk / activity board: any workflow touch today (submit, revive,
   * approve, pick, complete). Matches get_billing_queue_snapshot p_created_from.
   */
  todayOnly?: boolean;
  /** Completed tab: bills closed today (completed_at), regardless of created_at. */
  completedTodayOnly?: boolean;
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
  /** Active sales_edit lock (submitted orders being edited by salesperson) — billing stage only */
  sales_edit_claim_info: ActiveClaimInfo | null;
  /** Is this order claimed by the current user? */
  is_mine: boolean;
  /** Number of lines where quoted price differs from book price. */
  special_rate_line_count: number;
  /** Total units carrying a special rate. */
  special_rate_qty: number;
  /** Lightweight line preview for queue cards (legacy fetch only). */
  order_items_preview?: OrderItemsPreview;
}

interface UseClaimableOrdersReturn {
  /** Orders with no active billing claim and no fresh sales_edit lock */
  available: OrderWithClaimInfo[];
  /** Orders claimed by the current user */
  myActive: OrderWithClaimInfo[];
  /** Orders claimed by someone else (fresh billing claim) */
  otherActive: OrderWithClaimInfo[];
  /** Orders with stale billing claims (heartbeat expired, can be taken over) */
  stale: OrderWithClaimInfo[];
  /** Submitted orders locked while a salesperson edits lines (fresh sales_edit claim) */
  salesLocked: OrderWithClaimInfo[];
  /** All orders combined */
  all: OrderWithClaimInfo[];
  /** Loading state */
  isLoading: boolean;
}

type BillingRealtimeStatus = 'disabled' | 'connected' | 'disconnected';

type BillingQueueSnapshotRow = {
  id: number;
  order_number: string;
  order_kind: 'standard' | 'recovery' | null;
  customer_id: number;
  customer_name: string;
  customer_city: string | null;
  transport_id: number | null;
  transport_name: string | null;
  salesperson_name: string;
  salesperson_user_id: number | null;
  reviewer_name: string | null;
  picker_name: string | null;
  stock_location_code: string | null;
  fulfillment_path: string | null;
  workflow_status: WorkflowStatus;
  priority: 'normal' | 'urgent';
  notes: string | null;
  item_count: number;
  ask_line_count: number;
  special_rate_line_count: number;
  special_rate_qty: number;
  total_value: number;
  created_at: string;
  approved_at: string | null;
  picked_at: string | null;
  completed_at: string | null;
  dispatched_at: string | null;
  claim_id: number | null;
  claimed_by_user_id: number | null;
  claimed_by_name: string | null;
  claimed_at: string | null;
  last_heartbeat_at: string | null;
  claim_is_stale: boolean | null;
  sales_edit_claim_id?: number | null;
  sales_edit_claimed_by_user_id?: number | null;
  sales_edit_claimed_by_name?: string | null;
  sales_edit_claimed_at?: string | null;
  sales_edit_last_heartbeat_at?: string | null;
  sales_edit_claim_is_stale?: boolean | null;
};

function getTodayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Match orders with any workflow activity on/after today (submit, revive, approve, pick, complete). */
function applyTodayActivityFilter<T extends { or: (filters: string) => T }>(
  query: T,
  todayIso: string,
): T {
  return query.or(
    [
      `created_at.gte.${todayIso}`,
      `revived_at.gte.${todayIso}`,
      `approved_at.gte.${todayIso}`,
      `picked_at.gte.${todayIso}`,
      `completed_at.gte.${todayIso}`,
    ].join(','),
  );
}

function workflowStatusesToArray(
  workflowStatus: WorkflowStatus | WorkflowStatus[] | undefined,
): WorkflowStatus[] | null {
  if (!workflowStatus) return null;
  return Array.isArray(workflowStatus) ? workflowStatus : [workflowStatus];
}

function shouldUseQueueEvents(stage: ClaimStage): boolean {
  return (stage === 'billing' || stage === 'picking') && QUEUE_EVENTS_ON;
}

function shouldUseBillingQueueSnapshot(stage: ClaimStage): boolean {
  return stage === 'billing' && QUEUE_EVENTS_ON;
}

type PickQueueBucket = 'available' | 'myActive' | 'otherActive' | 'stale';

/** Bucket a pick-queue row — hide in-progress picks from other pickers' available list. */
function categorizePickQueueOrder(
  order: OrderWithClaimInfo,
  userName: string | null,
): PickQueueBucket {
  const claim = order.claim_info;

  // Stale in-progress picks stay on the assignee's queue; others go to the pool.
  if (claim?.is_stale && order.workflow_status === 'picking') {
    if (order.is_mine) return 'myActive';
    return 'stale';
  }
  if (claim && order.is_mine) return 'myActive';
  if (claim && !order.is_mine) return 'otherActive';

  // Claim row not loaded yet — trust workflow_status + picker_name.
  if (order.workflow_status === 'picking') {
    if (userName != null && order.picker_name === userName) return 'myActive';
    return 'otherActive';
  }
  if (order.workflow_status === 'approved') {
    if (userName != null && order.picker_name === userName) return 'myActive';
    if (order.picker_name) return 'otherActive';
    return 'available';
  }

  return 'otherActive';
}

async function fetchLegacyClaimableOrders(
  options: ClaimableOrdersOptions,
  userId: number | null,
  pickerBranch: StockLocationCode | null,
): Promise<OrderWithClaimInfo[]> {
  const { stage, workflowStatus, todayOnly, completedTodayOnly } = options;
  const todayIso = getTodayStartIso();

  let orderQuery = supabase
    .from('orders')
    .select(ORDERS_SELECT_WITH_ITEM_LINE_COUNT)
    .order('created_at', { ascending: false });

  if (workflowStatus) {
    if (Array.isArray(workflowStatus)) {
      orderQuery = orderQuery.in('workflow_status', workflowStatus);
    } else {
      orderQuery = orderQuery.eq('workflow_status', workflowStatus);
    }
  }

  if (completedTodayOnly) {
    orderQuery = orderQuery.gte('completed_at', todayIso);
  } else if (todayOnly) {
    orderQuery = applyTodayActivityFilter(orderQuery, todayIso);
  }

  const { data: rawOrders, error: orderError } = await orderQuery;
  if (orderError) throw orderError;
  if (!rawOrders || rawOrders.length === 0) return [];

  let orders = normalizeOrderListBusyItemCount(
    rawOrders as OrderRowWithEmbed[],
  );

  if (stage === 'picking') {
    orders = orders.filter((order) => isPickQueueEligibleForBranch(order, pickerBranch));
  }

  const orderIds = orders.map((o: Order) => o.id);
  const customerIds = [...new Set(
    orders
      .map((o: Order) => o.customer_id)
      .filter((id): id is number => typeof id === 'number'),
  )];

  const customerAddressMap = new Map<number, string | null>();
  if (customerIds.length > 0) {
    const { data: customers, error: customerError } = await supabase
      .from('customers')
      .select('id, address, address1, address2, address3')
      .in('id', customerIds);

    if (customerError) throw customerError;

    for (const customer of customers ?? []) {
      customerAddressMap.set(customer.id, getCustomerAddress(customer));
    }
  }

  const claimStages = stage === 'billing' ? ['billing', 'sales_edit'] : [stage];

  const { data: claims, error: claimError } = await supabase
    .from('work_claims')
    .select('id, order_id, stage, claimed_by_user_id, claimed_at, last_heartbeat_at, status, users!work_claims_claimed_by_user_id_fkey(full_name)')
    .in('order_id', orderIds)
    .in('stage', claimStages)
    .eq('status', 'active');

  if (claimError) throw claimError;

  const claimMap = new Map<number, ActiveClaimInfo>();
  const salesEditClaimMap = new Map<number, ActiveClaimInfo>();
  const now = Date.now();

  for (const claim of claims ?? []) {
    const heartbeatAge = now - new Date(claim.last_heartbeat_at).getTime();
    const userRecord = claim.users as unknown as { full_name: string } | null;
    const info: ActiveClaimInfo = {
      claim_id: Number(claim.id),
      claimed_by_user_id: Number(claim.claimed_by_user_id),
      claimed_by_name: userRecord?.full_name ?? 'Unknown',
      claimed_at: claim.claimed_at,
      last_heartbeat_at: claim.last_heartbeat_at,
      is_stale: heartbeatAge > STALE_THRESHOLD_MS,
    };
    const claimStage = claim.stage as string;
    if (claimStage === 'sales_edit') {
      salesEditClaimMap.set(claim.order_id, info);
    } else if (claimStage === stage) {
      claimMap.set(claim.order_id, info);
    }
  }

  return orders.map((order): OrderWithClaimInfo => {
    const claimInfo = claimMap.get(order.id) ?? null;
    const salesEditInfo = salesEditClaimMap.get(order.id) ?? null;
    return {
      ...order,
      customer_address:
        typeof order.customer_id === 'number'
          ? (customerAddressMap.get(order.customer_id) ?? null)
          : null,
      claim_info: claimInfo,
      sales_edit_claim_info: salesEditInfo,
      is_mine: claimInfo?.claimed_by_user_id === userId,
    };
  });
}

async function fetchBillingQueueSnapshot(
  options: ClaimableOrdersOptions,
  userId: number | null,
): Promise<OrderWithClaimInfo[]> {
  const todayIso = getTodayStartIso();
  const { data, error } = await supabase.rpc('get_billing_queue_snapshot', {
    p_statuses: workflowStatusesToArray(options.workflowStatus),
    p_created_from: options.todayOnly ? todayIso : null,
    p_created_to: null,
    p_completed_from: options.completedTodayOnly ? todayIso : null,
  });

  if (error) throw error;

  return ((data ?? []) as BillingQueueSnapshotRow[]).map((row): OrderWithClaimInfo => {
    const claimInfo =
      row.claim_id != null &&
      row.claimed_by_user_id != null &&
      row.claimed_at != null &&
      row.last_heartbeat_at != null
        ? {
            claim_id: Number(row.claim_id),
            claimed_by_user_id: Number(row.claimed_by_user_id),
            claimed_by_name: row.claimed_by_name ?? 'Unknown',
            claimed_at: row.claimed_at,
            last_heartbeat_at: row.last_heartbeat_at,
            is_stale: Boolean(row.claim_is_stale),
          }
        : null;

    const salesEditInfo =
      row.sales_edit_claim_id != null &&
      row.sales_edit_claimed_by_user_id != null &&
      row.sales_edit_claimed_at != null &&
      row.sales_edit_last_heartbeat_at != null
        ? {
            claim_id: Number(row.sales_edit_claim_id),
            claimed_by_user_id: Number(row.sales_edit_claimed_by_user_id),
            claimed_by_name: row.sales_edit_claimed_by_name ?? 'Unknown',
            claimed_at: row.sales_edit_claimed_at,
            last_heartbeat_at: row.sales_edit_last_heartbeat_at,
            is_stale: Boolean(row.sales_edit_claim_is_stale),
          }
        : null;

    return {
      id: Number(row.id),
      order_number: row.order_number,
      order_kind: row.order_kind ?? 'standard',
      customer_id: Number(row.customer_id),
      customer_name: row.customer_name,
      customer_city: row.customer_city,
      transport_id: row.transport_id == null ? null : Number(row.transport_id),
      transport_name: row.transport_name,
      salesperson_name: row.salesperson_name,
      salesperson_user_id:
        row.salesperson_user_id == null ? null : Number(row.salesperson_user_id),
      reviewer_name: row.reviewer_name,
      picker_name: row.picker_name,
      stock_location_code: (row.stock_location_code as StockLocationCode | null) ?? null,
      fulfillment_path: (row.fulfillment_path as FulfillmentPath | null) ?? null,
      workflow_status: row.workflow_status,
      priority: row.priority,
      notes: row.notes,
      item_count: Number(row.item_count ?? 0),
      ask_line_count: Number(row.ask_line_count ?? 0),
      special_rate_line_count: Number(row.special_rate_line_count ?? 0),
      special_rate_qty: Number(row.special_rate_qty ?? 0),
      order_items_preview: [],
      total_value: Number(row.total_value ?? 0),
      created_at: row.created_at,
      approved_at: row.approved_at,
      picked_at: row.picked_at,
      completed_at: row.completed_at,
      dispatched_at: row.dispatched_at,
      claim_info: claimInfo,
      sales_edit_claim_info: salesEditInfo,
      is_mine: claimInfo?.claimed_by_user_id === userId,
    };
  });
}

function buildClaimableOrdersQueryKey(
  stage: ClaimStage,
  statusKey: string,
  todayOnly: boolean | undefined,
  completedTodayOnly: boolean | undefined,
  billingEventsEnabled: boolean,
) {
  return [
    'claimable-orders',
    stage,
    statusKey,
    todayOnly ?? false,
    completedTodayOnly ?? false,
    billingEventsEnabled ? 'billing-events' : 'legacy',
  ] as const;
}

/** Fire-and-forget prefetch — warm queue data before the picker screen mounts. */
export function prefetchClaimableOrders(
  options: ClaimableOrdersOptions,
  userId: number | null,
  pickerBranch: StockLocationCode | null = null,
): void {
  const statusKey = Array.isArray(options.workflowStatus)
    ? options.workflowStatus.join(',')
    : options.workflowStatus ?? 'all';
  const billingEventsEnabled = shouldUseBillingQueueSnapshot(options.stage);

  void queryClient.prefetchQuery({
    queryKey: buildClaimableOrdersQueryKey(
      options.stage,
      statusKey,
      options.todayOnly,
      options.completedTodayOnly,
      billingEventsEnabled,
    ),
    queryFn: async () => {
      if (!billingEventsEnabled) {
        return fetchLegacyClaimableOrders(options, userId, pickerBranch);
      }
      try {
        return await fetchBillingQueueSnapshot(options, userId);
      } catch {
        return fetchLegacyClaimableOrders(options, userId, pickerBranch);
      }
    },
    staleTime: 0,
  });
}

/**
 * Fetch orders enriched with active claim info for a given stage.
 *
 * Billing can use a compact snapshot RPC + low-volume queue_events stream.
 * Other stages keep the legacy table reads/subscriptions for compatibility.
 */
export function useClaimableOrders(
  options: ClaimableOrdersOptions,
): UseClaimableOrdersReturn {
  const { userId, userName, branch } = useAuth();
  const { stage, workflowStatus, todayOnly, completedTodayOnly } = options;
  const [billingSnapshotFailed, setBillingSnapshotFailed] = useState(false);
  const [billingRealtimeStatus, setBillingRealtimeStatus] =
    useState<BillingRealtimeStatus>(REALTIME_ON ? 'disconnected' : 'disabled');
  const queueEventsEnabled = shouldUseQueueEvents(stage) && !billingSnapshotFailed;
  const billingEventsEnabled =
    shouldUseBillingQueueSnapshot(stage) && !billingSnapshotFailed;

  const statusKey = Array.isArray(workflowStatus)
    ? workflowStatus.join(',')
    : workflowStatus ?? 'all';

  const queryKey = useMemo(
    () =>
      buildClaimableOrdersQueryKey(
        stage,
        statusKey,
        todayOnly,
        completedTodayOnly,
        billingEventsEnabled,
      ),
    [stage, statusKey, todayOnly, completedTodayOnly, billingEventsEnabled],
  );

  const result = useQuery<OrderWithClaimInfo[]>({
    queryKey,
    queryFn: async () => {
      if (!billingEventsEnabled) {
        return fetchLegacyClaimableOrders(options, userId, branch);
      }

      try {
        return await fetchBillingQueueSnapshot(options, userId);
      } catch (error) {
        console.warn('[billing-queue] snapshot RPC failed; falling back to legacy query', error);
        setBillingSnapshotFailed(true);
        return fetchLegacyClaimableOrders(options, userId, branch);
      }
    },
    staleTime: 0,
    refetchInterval: (query) => {
      if (query.state.data === undefined) return false;
      if (queueEventsEnabled) {
        return billingRealtimeStatus === 'connected'
          ? BILLING_EVENT_CONNECTED_KEEPALIVE_INTERVAL_MS
          : BILLING_EVENT_DEGRADED_KEEPALIVE_INTERVAL_MS;
      }
      if (!REALTIME_ON) return POLL_NO_REALTIME_MS;
      return KEEPALIVE_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });

  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const setBillingStatus = (next: BillingRealtimeStatus) => {
      setBillingRealtimeStatus((current) => (current === next ? current : next));
    };

    const invalidateNow = () => {
      void queryClient.invalidateQueries({ queryKey });
    };

    if (!REALTIME_ON) {
      setBillingStatus('disabled');
      return;
    }

    const scheduleInvalidate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        invalidateNow();
      }, REALTIME_DEBOUNCE_MS);
    };

    if (queueEventsEnabled) {
      setBillingStatus('disconnected');

      const unsubQueueEvents = subscribeToTable({
        channelName: `queue-events:${stage}:${statusKey}:${todayOnly ?? false}:${completedTodayOnly ?? false}`,
        table: 'queue_events',
        filter: `stage=eq.${stage}`,
        events: ['INSERT'],
        onChange: invalidateNow,
        onSubscribe: () => setBillingStatus('connected'),
        onReconnect: () => {
          setBillingStatus('connected');
          invalidateNow();
        },
        onGiveUp: () => setBillingStatus('disconnected'),
      });

      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        unsubQueueEvents();
      };
    }

    setBillingStatus('disabled');

    if (!DIRECT_TABLE_REALTIME_ON) {
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }

    const ordersFilter =
      typeof workflowStatus === 'string'
        ? `workflow_status=eq.${workflowStatus}`
        : undefined;

    const unsubOrders = subscribeToTable({
      channelName: `claimable-orders:${stage}:${statusKey}:${todayOnly ?? false}:${completedTodayOnly ?? false}`,
      table: 'orders',
      filter: ordersFilter,
      onChange: scheduleInvalidate,
      onReconnect: invalidateNow,
    });

    const unsubClaims =
      stage === 'picking'
        ? subscribeToTable({
            channelName: `claimable-orders-claims:${statusKey}:${todayOnly ?? false}:${completedTodayOnly ?? false}`,
            table: 'work_claims',
            filter: 'stage=eq.picking',
            onChange: scheduleInvalidate,
            onReconnect: invalidateNow,
          })
        : null;

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      unsubOrders();
      unsubClaims?.();
    };
  }, [
    billingEventsEnabled,
    queueEventsEnabled,
    queryClient,
    queryKey,
    stage,
    statusKey,
    todayOnly,
    completedTodayOnly,
    workflowStatus,
  ]);

  const categorized = useMemo(() => {
    let all = result.data ?? [];
    if (stage === 'picking') {
      all = all.filter((order) => isPickQueueEligibleForBranch(order, branch));
    }
    const available: OrderWithClaimInfo[] = [];
    const myActive: OrderWithClaimInfo[] = [];
    const otherActive: OrderWithClaimInfo[] = [];
    const stale: OrderWithClaimInfo[] = [];
    const salesLocked: OrderWithClaimInfo[] = [];

    for (const order of all) {
      if (stage === 'picking') {
        switch (categorizePickQueueOrder(order, userName)) {
          case 'myActive':
            myActive.push(order);
            break;
          case 'stale':
            stale.push(order);
            break;
          case 'otherActive':
            otherActive.push(order);
            break;
          case 'available':
            available.push(order);
            break;
        }
        continue;
      }

      const billing = order.claim_info;
      const se = order.sales_edit_claim_info;
      const freshSalesLock = Boolean(se && !se.is_stale);

      if (billing && order.is_mine) {
        myActive.push(order);
      } else if (billing && billing.is_stale) {
        stale.push(order);
      } else if (billing && !billing.is_stale) {
        otherActive.push(order);
      } else if (freshSalesLock) {
        salesLocked.push(order);
      } else {
        available.push(order);
      }
    }

    return { available, myActive, otherActive, stale, salesLocked, all };
  }, [branch, result.data, stage, userName]);

  return {
    ...categorized,
    isLoading: result.isLoading,
  };
}

/** True when a salesperson holds a fresh sales_edit lock — billing should treat the row as frozen. */
export function isSalesEditFreshLock(order: OrderWithClaimInfo): boolean {
  const se = order.sales_edit_claim_info;
  return Boolean(se && !se.is_stale);
}
