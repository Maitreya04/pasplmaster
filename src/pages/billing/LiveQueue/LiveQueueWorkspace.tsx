import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase/client';
import { useClaimableOrders, isSalesEditFreshLock } from '../../../hooks/useClaimableOrders';
import { useOrderDetail } from '../../../hooks/useOrderDetail';
import { useWorkClaim } from '../../../hooks/useWorkClaim';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { sendPickerReadyNotification } from '../../../lib/pickerPush';
import { applyBillingApprove } from '../../../lib/billing/applyBillingApprove';
import { completeBillingWithClaim } from '../../../lib/billing/completeBilling';
import { shouldNotifyPickers } from '../../../lib/billing/fulfillmentPath';
import type { FulfillmentPath } from '../../../types';
import { useRejectBillingOrder } from '../../../hooks/useRejectBillingOrder';
import { formatSupabaseUserMessage } from '../../../lib/supabase/formatUserMessage';
import {
  captureBillingLiveQueueBaseline,
  persistBillingLiveQueueDraft,
  type BillingLineEdit,
} from '../../../lib/billing/liveQueueDraft';
import { billingClaimFailureMessage } from '../../../lib/billing/claimFailureMessage';
import { clearBusyEnteredIds } from '../../../lib/billing/busyEntrySession';
import { sortBillLines } from '../../../lib/billing/sortBillLines';

import { useBillingFlow } from '../../../hooks/useBillingFlow';
import { useBillingStockFreshness } from '../../../hooks/useBillingStockFreshness';
import { invalidateLocationwiseStockQueries } from '../../../hooks/useLocationwiseStock';
import { QueueView } from './QueueView';
import { OrderSheetView } from './OrderSheetView';
import { ReportView } from './ReportView';
import { AddLineSheet } from './AddLineSheet';
import type { OrderWithClaimInfo } from '../../../hooks/useClaimableOrders';
import type { OrderItem } from '../../../types';
import type { ItemFlag } from '../../../hooks/useBillingFlow';

/** Frozen at approve time so the report/WhatsApp text stays correct after the order drops off the submitted queue. */
type BillingReportSnapshot = {
  orderId: number;
  orderNumber: string;
  orderName: string;
  salesperson: string | null;
  items: OrderItem[];
  flags: Record<number, ItemFlag>;
  resolvedFulfillmentPath: FulfillmentPath;
  effectivePickLineCount: number;
};

function mergeOrderLine(item: OrderItem, edit?: BillingLineEdit): OrderItem {
  if (!edit || edit.removed) return item;
  return {
    ...item,
    qty_requested: edit.qtyRequested ?? item.qty_requested,
    price_quoted: edit.priceQuoted ?? item.price_quoted,
  };
}

function sortByUrgencyAndAge(orders: OrderWithClaimInfo[]): OrderWithClaimInfo[] {
  return [...orders].sort((a, b) => {
    if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
    if (a.priority !== 'urgent' && b.priority === 'urgent') return 1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

interface LiveQueueWorkspaceProps {
  /** When true, fills a desk panel instead of the full page. */
  embedded?: boolean;
  /** Desk mode: after warehouse-pick approve, hand off to inline assign instead of report. */
  onApprovedForAssign?: (orderId: number) => void;
}

export function LiveQueueWorkspace({
  embedded = false,
  onApprovedForAssign,
}: LiveQueueWorkspaceProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userName, userId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── URL-driven order pre-selection (e.g. from Dashboard click) ──
  const preSelectedOrderId = !embedded && searchParams.get('orderId')
    ? Number(searchParams.get('orderId'))
    : null;

  // 1. Queue Data
  const { available, myActive, otherActive, stale, salesLocked, isLoading: queueLoading, isError: queueError } = useClaimableOrders({
    stage: 'billing',
    workflowStatus: 'submitted',
  });

  const queue = useMemo(
    () => sortByUrgencyAndAge([...myActive, ...available, ...stale]),
    [myActive, available, stale],
  );

  useEffect(() => {
    if (!queueError || queueLoading) return;
    toast.error('Could not load the billing queue. Check your connection and reload.');
  }, [queueError, queueLoading, toast]);

  const [currentOrderId, setCurrentOrderId] = useState<number | null>(null);

  // Sync active order from myActive only when nothing is selected.
  // This prevents jumping back to the previous order while queue data is catching up
  // after approval/next transitions.
  useEffect(() => {
    if (currentOrderId == null && myActive.length > 0) {
      setCurrentOrderId(myActive[0].id);
    }
  }, [myActive, currentOrderId]);

  const activeInQueue = useMemo(() => {
    if (currentOrderId) {
      const found = queue.find((o) => o.id === currentOrderId);
      if (found) return found;
      const frozen = salesLocked.find((o) => o.id === currentOrderId);
      if (frozen) return frozen;
    }
    if (myActive.length > 0) return myActive[0];
    return queue[0] ?? null;
  }, [myActive, currentOrderId, queue, salesLocked]);

  const effectiveOrderId = activeInQueue?.id ?? null;

  const claimAttempted = useRef<number | null>(null);
  const claimFailureToasted = useRef<number | null>(null);
  const missingSelectionToasted = useRef(false);

  useEffect(() => {
    claimAttempted.current = null;
    claimFailureToasted.current = null;
    missingSelectionToasted.current = false;
  }, [effectiveOrderId, userId]);

  const activeOrderSalesLocked =
    activeInQueue != null && isSalesEditFreshLock(activeInQueue);

  const handleBillingClaimLost = useCallback(() => {
    claimAttempted.current = null;
    claimFailureToasted.current = null;
    toast.warning('Billing claim expired — reclaiming this order…');
  }, [toast]);

  // 2. Work Claim logic
  const { claimId, isClaimedByMe, claim, release } = useWorkClaim(effectiveOrderId, 'billing', {
    onClaimLost: handleBillingClaimLost,
  });

  // 3. Order Details
  const { data: order, isLoading: orderLoading, isError: orderError } = useOrderDetail(effectiveOrderId);
  const items = useMemo(() => order?.items ?? [], [order]);

  // 4. New 3-state machine
  const flow = useBillingFlow();
  const flowRef = useRef(flow);
  flowRef.current = flow;

  /** qty_shippable / qty_po when the sheet was opened — used to restore cleared lines on draft save. */
  const draftBaselineRef = useRef<Map<number, { qty_shippable: number; qty_po: number }>>(new Map());
  const hydratedSessionRef = useRef<{ orderId: number } | null>(null);
  const itemsRef = useRef<OrderItem[]>([]);
  const orderRef = useRef(order);
  itemsRef.current = items;
  orderRef.current = order;

  const [addLineOpen, setAddLineOpen] = useState(false);
  const [sessionNewOrderItemIds, setSessionNewOrderItemIds] = useState<Set<number>>(() => new Set());

  const billingReportSnapshotRef = useRef<BillingReportSnapshot | null>(null);

  useEffect(() => {
    setSessionNewOrderItemIds(new Set());
    setAddLineOpen(false);
  }, [effectiveOrderId]);

  useEffect(() => {
    if (flow.state !== 'orderSheet') return;
    if (items.length === 0) return;
    flowRef.current.pruneLineEditsForRemovedRows(new Set(items.map((i) => i.id)));
  }, [items, flow.state]);

  const freshnessQuery = useBillingStockFreshness(
    flow.state === 'orderSheet' ? effectiveOrderId : null,
    items,
    order?.stock_location_code,
  );

  const persistLiveQueueDraftIfDirty = useCallback(async () => {
    if (!flowRef.current.isDraftDirty()) return;
    const oid = orderRef.current?.id ?? null;
    const itemsSnap = itemsRef.current;
    const flagsSnap = flowRef.current.flags;
    const lineEditsSnap = flowRef.current.lineEdits;
    const baseline = draftBaselineRef.current;
    if (!oid || itemsSnap.length === 0 || baseline.size === 0) return;

    const { error } = await persistBillingLiveQueueDraft({
      items: itemsSnap,
      flags: flagsSnap,
      baseline,
      lineEdits: lineEditsSnap,
    });
    if (error) {
      console.error('[LiveQueue] draft persist failed', error);
      toast.error('Could not save stock flags. Try again before leaving.');
    } else {
      flowRef.current.resetDraftDirty();
      void queryClient.invalidateQueries({ queryKey: ['order', oid] });
      void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
    }
  }, [queryClient, toast]);

  const handleApplyLiveStock = useCallback(
    async (orderItemId: number, liveCapacity: number) => {
      const o = orderRef.current;
      if (!o?.id) return;

      const row = itemsRef.current.find((i) => i.id === orderItemId);
      if (!row) return;

      const edits = flowRef.current.lineEdits[orderItemId];
      const qtyReq = edits?.qtyRequested ?? row.qty_requested;

      const qtyPo = Math.max(0, qtyReq - liveCapacity);
      const patch = {
        qty_shippable: liveCapacity,
        qty_po: qtyPo,
        qty_approved: liveCapacity,
      };

      const { error } = await supabase.from('order_items').update(patch).eq('id', orderItemId);
      if (error) {
        toast.error(error.message ?? 'Could not apply live stock');
        return;
      }

      draftBaselineRef.current.set(orderItemId, {
        qty_shippable: liveCapacity,
        qty_po: qtyPo,
      });

      if (liveCapacity <= 0 && qtyReq > 0) {
        flowRef.current.flagNoStock(orderItemId);
      } else if (liveCapacity < qtyReq) {
        flowRef.current.flagPartial(orderItemId, liveCapacity);
      } else {
        flowRef.current.clearFlag(orderItemId);
      }
      flowRef.current.markDraftDirty();

      await queryClient.invalidateQueries({ queryKey: ['order', o.id] });
      await queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] });
    },
    [queryClient, toast],
  );

  // Reset sheet hydration when the targeted order changes
  useEffect(() => {
    hydratedSessionRef.current = null;
  }, [effectiveOrderId]);

  // One-time hydrate when entering the order sheet (avoid overwriting in-progress flags on refetch)
  useEffect(() => {
    if (flow.state === 'queue' || flow.state === 'report') {
      if (flow.state === 'queue') hydratedSessionRef.current = null;
      return;
    }
    if (flow.state !== 'orderSheet' || !order || order.id !== effectiveOrderId || items.length === 0) {
      return;
    }
    if (hydratedSessionRef.current?.orderId === order.id) return;

    draftBaselineRef.current = captureBillingLiveQueueBaseline(items);
    flow.hydrateFromItems(items);
    hydratedSessionRef.current = { orderId: order.id };
  }, [flow.state, order, effectiveOrderId, items, flow]);

  useEffect(() => {
    return () => {
      void persistLiveQueueDraftIfDirty();
    };
  }, [persistLiveQueueDraftIfDirty]);

  // ── Handle pre-selection from URL on mount ──
  const didConsumeParam = useRef(false);
  useEffect(() => {
    if (!preSelectedOrderId || didConsumeParam.current || queueLoading) return;

    didConsumeParam.current = true;
    setSearchParams({}, { replace: true });

    const selectable = [...myActive, ...available, ...stale, ...salesLocked];
    const found = selectable.find((o) => o.id === preSelectedOrderId);
    if (found) {
      setCurrentOrderId(preSelectedOrderId);
      flow.openOrder();
      return;
    }

    if (!missingSelectionToasted.current) {
      missingSelectionToasted.current = true;
      toast.info('That order is no longer in the live billing queue.');
    }
  }, [
    preSelectedOrderId,
    queueLoading,
    myActive,
    available,
    stale,
    salesLocked,
    flow,
    setSearchParams,
    toast,
  ]);

  useEffect(() => {
    if (flow.state !== 'orderSheet' || effectiveOrderId || queueLoading) return;

    claimAttempted.current = null;
    claimFailureToasted.current = null;
    setCurrentOrderId(null);
    flow.returnToQueue();

    if (!missingSelectionToasted.current) {
      missingSelectionToasted.current = true;
      toast.info('That order is no longer in the live billing queue.');
    }
  }, [flow.state, effectiveOrderId, queueLoading, flow, toast]);

  useEffect(() => {
    if (flow.state !== 'orderSheet' || orderLoading || !orderError) return;

    toast.error('Could not load this order. Returning to the queue.');
    claimAttempted.current = null;
    claimFailureToasted.current = null;
    setCurrentOrderId(null);
    flow.returnToQueue();
  }, [flow.state, orderLoading, orderError, flow, toast]);

  // ── Urgent order detection ──
  const urgentInQueue = useMemo(
    () => queue.filter((o) => o.priority === 'urgent' && o.id !== effectiveOrderId),
    [queue, effectiveOrderId],
  );
  const hasUrgentInterrupt =
    urgentInQueue.length > 0 &&
    flow.state !== 'queue' &&
    activeInQueue?.priority !== 'urgent';

  // Block billing sheet when order is frozen by sales edit (e.g. URL preselect).
  useEffect(() => {
    if (flow.state !== 'orderSheet' || !activeInQueue) return;
    if (!isSalesEditFreshLock(activeInQueue)) return;
    const who = activeInQueue.sales_edit_claim_info?.claimed_by_name ?? 'Sales';
    toast.warning(`This order is frozen — ${who} is editing it from My Orders.`);
    claimAttempted.current = null;
    flow.returnToQueue();
    setCurrentOrderId(null);
  }, [flow.state, activeInQueue, flow, toast]);

  useEffect(() => {
    if (flow.state !== 'orderSheet' || !effectiveOrderId || isClaimedByMe) return;
    if (activeOrderSalesLocked) return;
    if (!userId) return;
    if (claimAttempted.current === effectiveOrderId) return;

    claimAttempted.current = effectiveOrderId;
    void (async () => {
      const result = await claim();
      if (result.success) return;

      if (result.reason === 'locked_by_sales_edit') {
        claimAttempted.current = null;
        const who =
          typeof result.locked_by_name === 'string' && result.locked_by_name.trim()
            ? result.locked_by_name.trim()
            : 'Sales';
        toast.warning(`Locked — ${who} is editing this order from sales.`);
        flowRef.current.returnToQueue();
        setCurrentOrderId(null);
        return;
      }

      if (result.reason === 'already_claimed') {
        if (claimFailureToasted.current !== effectiveOrderId) {
          claimFailureToasted.current = effectiveOrderId;
          const who =
            typeof result.claimed_by === 'string' && result.claimed_by.trim()
              ? result.claimed_by
              : 'someone else';
          toast.warning(
            `Being billed by ${who}. Take over from the queue if their session is stale.`,
          );
        }
        return;
      }

      if (claimFailureToasted.current !== effectiveOrderId) {
        claimFailureToasted.current = effectiveOrderId;
        toast.error(
          `Could not claim order: ${billingClaimFailureMessage(result.reason)}`,
        );
      }
    })();
  }, [
    flow.state,
    effectiveOrderId,
    isClaimedByMe,
    claim,
    toast,
    activeOrderSalesLocked,
    userId,
  ]);

  // ── Skip / Release ──
  const handleSkip = useCallback(async () => {
    await persistLiveQueueDraftIfDirty();
    if (claimId && userId) {
      try {
        await release();
      } catch {
        console.warn('Failed to release claim gracefully');
      }
    }
    setCurrentOrderId(null);
    claimAttempted.current = null;
    flow.returnToQueue();
  }, [claimId, userId, release, flow, persistLiveQueueDraftIfDirty]);

  // ── Urgent interrupt ──
  const handleUrgentInterrupt = useCallback(async () => {
    const urgentOrder = urgentInQueue[0];
    if (!urgentOrder) return;

    await persistLiveQueueDraftIfDirty();

    if (claimId && userId) {
      try {
        await release();
      } catch { /* best effort */ }
    }

    claimAttempted.current = null;
    flow.returnToQueue();
    setCurrentOrderId(urgentOrder.id);
    setTimeout(() => flow.openOrder(), 50);
    toast.info(`Switching to urgent order: ${urgentOrder.customer_name}`);
  }, [urgentInQueue, claimId, userId, release, flow, toast, persistLiveQueueDraftIfDirty]);

  // ── Complete Billing (Approve): merges flags + local line edits, deletes removed rows, audits order_events ──
  const approveMutation = useMutation({
    mutationFn: async (fulfillmentPath: FulfillmentPath) => {
      if (!order) throw new Error('No order selected.');
      if (!userId) {
        throw new Error(
          'Cannot approve — your billing user profile is not loaded. Log out, pick your name again, and retry.',
        );
      }

      const claimResult = await claim();
      if (!claimResult.success || !claimResult.claim_id) {
        const who =
          typeof claimResult.claimed_by === 'string' && claimResult.claimed_by.trim()
            ? ` (${claimResult.claimed_by})`
            : '';
        if (claimResult.reason === 'already_claimed') {
          throw new Error(
            `Cannot approve — order is being billed by${who}. Take over from the queue if their session is stale.`,
          );
        }
        throw new Error(
          `Cannot approve — billing claim failed${who}: ${claimResult.reason ?? 'unknown error'}`,
        );
      }
      const activeClaimId = claimResult.claim_id;

      const reviewer = userName || 'Billing';

      const flags = flowRef.current.flags;
      const lineEdits = flowRef.current.lineEdits;
      const serverItems = itemsRef.current;

      const removedLines = serverItems.filter((it) => lineEdits[it.id]?.removed);
      const visibleLines = serverItems.filter((it) => !lineEdits[it.id]?.removed);

      if (visibleLines.length === 0) {
        throw new Error('Cannot approve an empty order. Use Reject instead.');
      }

      const nowIso = new Date().toISOString();

      for (const line of removedLines) {
        const { error: evErr } = await supabase.from('order_events').insert({
          order_id: order.id,
          event_type: 'billing_line_removed',
          actor_user_id: userId,
          stage: 'billing',
          payload: {
            order_item_id: line.id,
            item_id: line.item_id,
            item_name: line.item_name,
            qty_requested: line.qty_requested,
          },
        });
        if (evErr) throw evErr;

        const { error: pendErr } = await supabase
          .from('pending_items')
          .update({
            status: 'cancelled',
            resolved_at: nowIso,
            resolved_by: reviewer,
            note: 'Line removed by billing',
          })
          .eq('order_id', order.id)
          .eq('item_id', line.item_id)
          .eq('status', 'pending');
        if (pendErr) throw pendErr;

        const { error: delErr } = await supabase.from('order_items').delete().eq('id', line.id);
        if (delErr) throw delErr;
      }

      const editEvents: Array<{
        order_id: number;
        event_type: string;
        actor_user_id: number;
        stage: string;
        payload: Record<string, unknown>;
      }> = [];

      for (const line of visibleLines) {
        const merged = mergeOrderLine(line, lineEdits[line.id]);
        const qtyChanged = merged.qty_requested !== line.qty_requested;
        const priceChanged = merged.price_quoted !== line.price_quoted;
        if (qtyChanged || priceChanged) {
          editEvents.push({
            order_id: order.id,
            event_type: 'billing_line_edited',
            actor_user_id: userId,
            stage: 'billing',
            payload: {
              order_item_id: line.id,
              item_id: line.item_id,
              before: {
                qty_requested: line.qty_requested,
                price_quoted: line.price_quoted,
              },
              after: {
                qty_requested: merged.qty_requested,
                price_quoted: merged.price_quoted,
              },
            },
          });
        }
      }

      if (editEvents.length > 0) {
        const { error: eeErr } = await supabase.from('order_events').insert(editEvents);
        if (eeErr) throw eeErr;
      }

      const visibleMergedForReport = sortBillLines(
        visibleLines.map((l) => mergeOrderLine(l, lineEdits[l.id])),
      );

      const snapFlags: Record<number, ItemFlag> = {};
      for (const it of visibleMergedForReport) {
        const f = flags[it.id];
        if (f) snapFlags[it.id] = f;
      }

      const approveResult = await applyBillingApprove({
        order: {
          id: order.id,
          order_number: order.order_number,
          customer_id: order.customer_id,
          customer_name: order.customer_name,
          salesperson_name: order.salesperson_name,
          stock_location_code: order.stock_location_code,
          priority: order.priority,
        },
        visibleLines: visibleMergedForReport,
        removedLines,
        flags,
        requestedFulfillmentPath: fulfillmentPath,
        reviewer,
        userId,
        notifySales: true,
      });

      const reportSnapshot: BillingReportSnapshot = {
        orderId: order.id,
        orderNumber: order.order_number?.trim() || '',
        orderName: order.customer_name?.trim() || 'Customer',
        salesperson: order.salesperson_name?.trim() || null,
        items: visibleMergedForReport.map((line) => ({ ...line })),
        flags: snapFlags,
        resolvedFulfillmentPath: approveResult.resolvedFulfillmentPath,
        effectivePickLineCount: approveResult.effectivePickLineCount,
      };

      const billingComplete = await completeBillingWithClaim({
        orderId: order.id,
        claimId: activeClaimId,
        userId,
        claim,
        isResolvingFlags: false,
        fulfillmentPath: approveResult.resolvedFulfillmentPath,
      });

      if (approveResult.clientPathDowngraded || billingComplete.pick_path_downgraded) {
        toast.info('No pickable lines — order direct-billed (skipped warehouse pick).');
      }

      const approvedAt = new Date().toISOString();
      if (shouldNotifyPickers(approveResult.resolvedFulfillmentPath)) {
        void sendPickerReadyNotification({
          eventType: 'order_ready_to_pick',
          orderId: order.id,
          orderNumber: order.order_number,
          customerName: order.customer_name,
          priority: order.priority,
          approvedAt,
        }).catch(() => { /* silent */ });
      }

      return reportSnapshot;
    },
    onSuccess: async (snapshot) => {
      billingReportSnapshotRef.current = snapshot;
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', snapshot.orderId] });
      void invalidateLocationwiseStockQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] });

      const sentToPick =
        snapshot.resolvedFulfillmentPath === 'warehouse_pick' &&
        snapshot.effectivePickLineCount > 0;

      if (embedded && sentToPick && onApprovedForAssign) {
        clearBusyEnteredIds(snapshot.orderId);
        billingReportSnapshotRef.current = null;

        if (claimId && userId) {
          try {
            await release();
          } catch {
            /* best effort */
          }
        }
        claimAttempted.current = null;
        setCurrentOrderId(null);
        flow.returnToQueue();
        onApprovedForAssign(snapshot.orderId);
        return;
      }

      flow.finishBilling();
    },
    onError: (err: unknown) => {
      console.error('[LiveQueue] approve failed', err);
      const msg = formatSupabaseUserMessage(err);
      toast.error(msg || 'Failed to approve order');
    },
  });

  const rejectMutation = useRejectBillingOrder(order, () => {
    void handleSkip();
  });

  // ── Urgent interrupt banner ──
  const urgentBanner = hasUrgentInterrupt ? (
    <div className={`ds-card border-2 border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] ${embedded ? 'mx-2 mt-2' : 'mx-4 mt-3'} mb-0 animate-slide-up shrink-0`}>
      <div className="flex items-center justify-between gap-4 p-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--bg-negative)] animate-pulse shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--content-negative)]">
              🔴 Urgent order arrived: {urgentInQueue[0].customer_name}
            </p>
            <p className="text-xs text-[var(--content-negative)] opacity-80 truncate">
              {urgentInQueue[0].item_count} items · {urgentInQueue[0].order_number}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleUrgentInterrupt}
          className="shrink-0 px-4 py-2 rounded-xl bg-[var(--bg-negative)] text-white text-sm font-bold hover:opacity-90 active:scale-95 transition-all"
        >
          Switch Now
        </button>
      </div>
    </div>
  ) : null;

  // ── Handle next from report (release claim, move to next order or queue) ──
  const handleNext = useCallback(async () => {
    const completedOrderId = billingReportSnapshotRef.current?.orderId ?? effectiveOrderId;
    billingReportSnapshotRef.current = null;

    if (claimId && userId) {
      try {
        await release();
      } catch { /* best effort */ }
    }
    claimAttempted.current = null;
    setCurrentOrderId(null);

    // If there are more orders, auto-claim next
    const remainingOrders = queue.filter(
      (o) =>
        o.id !== completedOrderId &&
        (!o.claim_info || o.is_mine) &&
        !isSalesEditFreshLock(o),
    );

    if (remainingOrders.length > 0) {
      const next = remainingOrders[0];
      setCurrentOrderId(next.id);
      flow.openOrder();
    } else {
      flow.nextOrder();
    }
  }, [claimId, userId, release, queue, effectiveOrderId, flow]);

  const shellClass = embedded
    ? 'h-full min-h-0 flex flex-col overflow-hidden bg-[var(--bg-secondary)]'
    : '';

  const loadingClass = embedded
    ? 'h-full min-h-[120px] bg-[var(--bg-primary)] animate-pulse'
    : 'min-h-screen bg-[var(--bg-primary)] animate-pulse';

  // ══════════════════════════════════════════
  //  VIEW ROUTING
  // ══════════════════════════════════════════

  if (flow.state === 'queue') {
    return (
      <div className={shellClass}>
        <QueueView
          embedded={embedded}
          available={available}
          otherActive={otherActive}
          stale={stale}
          myActive={myActive}
          salesLocked={salesLocked}
          isLoading={queueLoading}
          onSelect={(orderId) => {
            claimAttempted.current = null;
            claimFailureToasted.current = null;
            setCurrentOrderId(orderId);
            flow.openOrder();
          }}
          onTakeover={(orderId) => {
            claimAttempted.current = null;
            claimFailureToasted.current = null;
            setCurrentOrderId(orderId);
            flow.openOrder();
          }}
        />
      </div>
    );
  }

  if (flow.state === 'orderSheet') {
    if (!effectiveOrderId) {
      return <div className={loadingClass} />;
    }

    if (!order || orderLoading) {
      return <div className={loadingClass} />;
    }

    return (
      <div className={shellClass}>
        {urgentBanner}
        <OrderSheetView
          orderId={order.id}
          embedded={embedded}
          orderName={order.customer_name}
          orderNumber={order.order_number}
          salesperson={order.salesperson_name}
          transportName={order.transport_name}
          customerAddress={order.customer_address ?? null}
          notes={order.notes}
          city={order.customer_city}
          itemCount={order.item_count}
          totalValue={order.total_value}
          priority={order.priority}
          createdAt={order.created_at}
          stockLocationCode={order.stock_location_code}
          items={items}
          flags={flow.flags}
          lineEdits={flow.lineEdits}
          freshnessMap={freshnessQuery.data ?? undefined}
          sessionNewOrderItemIds={sessionNewOrderItemIds}
          addedLinesSessionCount={sessionNewOrderItemIds.size}
          isClaiming={!isClaimedByMe}
          isApproving={approveMutation.isPending}
          isRejecting={rejectMutation.isPending}
          onFlagNoStock={flow.flagNoStock}
          onFlagPartial={flow.flagPartial}
          onClearFlag={flow.clearFlag}
          onEditLineQty={flow.editLineQty}
          onEditLineRate={flow.editLineRate}
          onRemoveLine={flow.removeLine}
          onRestoreLine={flow.restoreLine}
          onApplyLiveStock={handleApplyLiveStock}
          onOpenAddLine={() => setAddLineOpen(true)}
          onFinish={(fulfillmentPath) => {
            if (!isClaimedByMe || approveMutation.isPending || rejectMutation.isPending) return;
            approveMutation.mutate(fulfillmentPath);
          }}
          onReject={(payload) => rejectMutation.mutate(payload)}
          onSkip={handleSkip}
        />
        <AddLineSheet
          isOpen={addLineOpen}
          onClose={() => setAddLineOpen(false)}
          orderId={order.id}
          stockLocationCode={order.stock_location_code}
          claimId={claimId}
          userId={userId}
          existingItems={items.map((i) => ({
            item_id: i.item_id,
            qty_requested: i.qty_requested,
            item_name: i.item_name,
          }))}
          onAdded={(orderItemId) => {
            setSessionNewOrderItemIds((prev) => new Set(prev).add(orderItemId));
          }}
        />
      </div>
    );
  }

  if (flow.state === 'report') {
    const snap = billingReportSnapshotRef.current;
    const completedId = snap?.orderId ?? effectiveOrderId;
    return (
      <div className={shellClass}>
        <ReportView
          embedded={embedded}
          orderName={snap?.orderName ?? order?.customer_name ?? 'Order'}
          orderNumber={snap?.orderNumber ?? order?.order_number ?? ''}
          salesperson={snap?.salesperson ?? order?.salesperson_name ?? null}
          items={snap?.items ?? items}
          flags={snap?.flags ?? {}}
          resolvedFulfillmentPath={snap?.resolvedFulfillmentPath ?? 'warehouse_pick'}
          effectivePickLineCount={snap?.effectivePickLineCount ?? 0}
          totalWaiting={Math.max(
            0,
            queue.filter(
              (o) =>
                (!o.claim_info || o.is_mine) &&
                !isSalesEditFreshLock(o) &&
                o.id !== completedId,
            ).length,
          )}
          onNext={handleNext}
        />
      </div>
    );
  }

  return (
    <div className={shellClass || 'min-h-screen bg-[var(--bg-primary)]'}>
      <QueueView
        embedded={embedded}
        available={available}
        otherActive={otherActive}
        stale={stale}
        myActive={myActive}
        salesLocked={salesLocked}
        isLoading={queueLoading}
        onSelect={(orderId) => {
          claimAttempted.current = null;
          claimFailureToasted.current = null;
          setCurrentOrderId(orderId);
          flow.openOrder();
        }}
        onTakeover={(orderId) => {
          claimAttempted.current = null;
          claimFailureToasted.current = null;
          setCurrentOrderId(orderId);
          flow.openOrder();
        }}
      />
    </div>
  );
}
