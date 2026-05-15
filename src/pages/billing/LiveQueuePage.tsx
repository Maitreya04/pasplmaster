import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { useClaimableOrders } from '../../hooks/useClaimableOrders';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { useWorkClaim } from '../../hooks/useWorkClaim';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  formatInternalNotificationError,
  sendInternalNotification,
  sendPickerReadyNotification,
} from '../../lib/pickerPush';
import { buildBillingCustomerUpdate } from '../../lib/buildBillingCustomerUpdate';
import { completeBillingWithClaim } from '../../lib/billing/completeBilling';
import {
  captureBillingLiveQueueBaseline,
  persistBillingLiveQueueDraft,
} from '../../lib/billing/liveQueueDraft';

import { useBillingFlow } from '../../hooks/useBillingFlow';
import { QueueView } from './LiveQueue/QueueView';
import { OrderSheetView } from './LiveQueue/OrderSheetView';
import { ReportView } from './LiveQueue/ReportView';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import type { OrderItem } from '../../types';

/** Frozen at approve time so the report/WhatsApp text stays correct after the order drops off the submitted queue. */
type BillingReportSnapshot = {
  orderId: number;
  orderNumber: string;
  orderName: string;
  salesperson: string | null;
  items: OrderItem[];
};

type LiveQueueLineState = {
  qtyBilled: number;
  qtyPending: number;
  pendingSource: 'billing' | 'sales' | null;
  pendingNote: string | null;
};

function deriveLiveQueueLineState(
  item: OrderItem,
  approvedQty: number,
  flag: { type: 'no_stock' | 'partial'; availableQty?: number } | undefined,
): LiveQueueLineState {
  const rawPending = Math.max(
    Math.max(0, item.qty_po ?? 0),
    Math.max(0, item.qty_requested - approvedQty),
    flag?.type === 'no_stock' ? item.qty_requested : 0,
  );
  const qtyPending = Math.min(item.qty_requested, rawPending);
  const qtyBilled = flag?.type === 'no_stock'
    ? 0
    : Math.max(0, Math.min(approvedQty, item.qty_requested - qtyPending));

  if (qtyPending <= 0) {
    return {
      qtyBilled,
      qtyPending: 0,
      pendingSource: null,
      pendingNote: null,
    };
  }

  return {
    qtyBilled,
    qtyPending,
    pendingSource: flag ? 'billing' : 'sales',
    pendingNote:
      flag?.type === 'no_stock'
        ? 'No stock in Busy — fully pending'
        : flag?.type === 'partial'
          ? `Partial stock — ${qtyBilled} billed, ${qtyPending} pending`
          : 'Purchase order qty from sales checkout',
  };
}

function sortByUrgencyAndAge(orders: OrderWithClaimInfo[]): OrderWithClaimInfo[] {
  return [...orders].sort((a, b) => {
    if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
    if (a.priority !== 'urgent' && b.priority === 'urgent') return 1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

export default function LiveQueuePage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userName, userId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── URL-driven order pre-selection (e.g. from Dashboard click) ──
  const preSelectedOrderId = searchParams.get('orderId')
    ? Number(searchParams.get('orderId'))
    : null;

  // 1. Queue Data
  const { available, myActive, otherActive, stale, isLoading: queueLoading } = useClaimableOrders({
    stage: 'billing',
    workflowStatus: 'submitted',
  });

  const queue = useMemo(
    () => sortByUrgencyAndAge([...myActive, ...available, ...stale]),
    [myActive, available, stale],
  );

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
    }
    if (myActive.length > 0) return myActive[0];
    return queue[0] ?? null;
  }, [myActive, currentOrderId, queue]);

  const effectiveOrderId = activeInQueue?.id ?? null;

  // 2. Work Claim logic
  const { claimId, isClaimedByMe, claim, release } = useWorkClaim(effectiveOrderId, 'billing');

  // 3. Order Details
  const { data: order, isLoading: orderLoading } = useOrderDetail(effectiveOrderId);
  const items = useMemo(() => order?.items ?? [], [order]);

  // 4. New 3-state machine
  const flow = useBillingFlow();
  const flowRef = useRef(flow);
  flowRef.current = flow;

  /** qty_shippable / qty_po when the sheet was opened — used to restore cleared lines on draft save. */
  const draftBaselineRef = useRef<Map<number, { qty_shippable: number; qty_po: number }>>(new Map());
  const hydratedSessionRef = useRef<{ orderId: number } | null>(null);
  const itemsRef = useRef<OrderItem[]>([]);
  const flagsRef = useRef(flow.flags);
  const orderRef = useRef(order);
  itemsRef.current = items;
  flagsRef.current = flow.flags;
  orderRef.current = order;

  const persistLiveQueueDraftIfDirty = useCallback(async () => {
    if (!flowRef.current.isDraftDirty()) return;
    const oid = orderRef.current?.id ?? null;
    const itemsSnap = itemsRef.current;
    const flagsSnap = flagsRef.current;
    const baseline = draftBaselineRef.current;
    if (!oid || itemsSnap.length === 0 || baseline.size === 0) return;

    const { error } = await persistBillingLiveQueueDraft({
      items: itemsSnap,
      flags: flagsSnap,
      baseline,
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
    if (preSelectedOrderId && !didConsumeParam.current) {
      didConsumeParam.current = true;
      setCurrentOrderId(preSelectedOrderId);
      setSearchParams({}, { replace: true });
      flow.openOrder();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preSelectedOrderId]);

  // ── Urgent order detection ──
  const urgentInQueue = useMemo(
    () => queue.filter((o) => o.priority === 'urgent' && o.id !== effectiveOrderId),
    [queue, effectiveOrderId],
  );
  const hasUrgentInterrupt =
    urgentInQueue.length > 0 &&
    flow.state !== 'queue' &&
    activeInQueue?.priority !== 'urgent';

  // Track auto-claiming
  const claimAttempted = useRef<number | null>(null);
  const billingReportSnapshotRef = useRef<BillingReportSnapshot | null>(null);

  // When entering orderSheet, fire the background claim
  useEffect(() => {
    if (
      flow.state === 'orderSheet' &&
      effectiveOrderId &&
      !isClaimedByMe &&
      claimAttempted.current !== effectiveOrderId
    ) {
      claimAttempted.current = effectiveOrderId;
      claim();
    }
  }, [flow.state, effectiveOrderId, isClaimedByMe, claim]);

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

  // ── Complete Billing (Approve) — simplified from flags only ──
  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!order || !userId) throw new Error('Cannot approve. Missing billing context.');
      const reviewer = userName || 'Billing';

      const reportSnapshot: BillingReportSnapshot = {
        orderId: order.id,
        orderNumber: order.order_number?.trim() || '',
        orderName: order.customer_name?.trim() || 'Customer',
        salesperson: order.salesperson_name?.trim() || null,
        items: items.map((line) => ({ ...line })),
      };

      // Resolve approved qty per line (sync)
      const lineResults = items.map((item, i) => {
        const flag = flow.flags[i];
        let approvedQty = item.qty_requested;
        if (flag?.type === 'no_stock') approvedQty = 0;
        else if (flag?.type === 'partial' && flag.availableQty != null) {
          approvedQty = flag.availableQty;
        }
        const finalState = deriveLiveQueueLineState(item, approvedQty, flag);
        return { item, approvedQty, flag, finalState };
      });

      // Parallel updates — sequential await per row was the main latency source (N round trips).
      const updateResponses = await Promise.all(
        lineResults.map(({ item, finalState }) =>
          supabase
            .from('order_items')
            .update({ qty_approved: finalState.qtyBilled, qty_po: finalState.qtyPending })
            .eq('id', item.id),
        ),
      );
      const updateError = updateResponses.find((r) => r.error)?.error;
      if (updateError) throw updateError;

      const { error: resolvePendingError } = await supabase
        .from('pending_items')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: reviewer,
        })
        .eq('order_id', order.id)
        .eq('status', 'pending');
      if (resolvePendingError) throw resolvePendingError;

      const pendingRows = lineResults
        .map(({ item, finalState }) => {
          if (finalState.qtyPending <= 0 || !finalState.pendingSource || !finalState.pendingNote) {
            return null;
          }
          return {
            order_id: order.id,
            order_number: order.order_number,
            customer_id: order.customer_id,
            customer_name: order.customer_name,
            item_id: item.item_id,
            item_name: item.item_name,
            qty_pending: finalState.qtyPending,
            source: finalState.pendingSource,
            created_by: reviewer,
            note: finalState.pendingNote,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row != null);

      if (pendingRows.length > 0) {
        const { error: pendingError } = await supabase.from('pending_items').insert(pendingRows);
        if (pendingError) throw pendingError;
      }

      const { messageText: customerMessageText, summary: customerMessageSummary } =
        buildBillingCustomerUpdate({
          orderNumber: order.order_number,
          customerName: order.customer_name,
          businessName: import.meta.env.VITE_BUSINESS_DISPLAY_NAME,
          date: new Date(),
          lines: lineResults.map(({ item, finalState }) => ({
            itemId: item.item_id,
            name: item.item_name,
            qtyRequested: item.qty_requested,
            qtyBilled: finalState.qtyBilled,
            qtyPending: finalState.qtyPending,
          })),
        });

      const { data: customerUpdateRow, error: customerUpdateError } = await supabase
        .from('billing_customer_updates')
        .insert({
          order_id: order.id,
          message_text: customerMessageText,
          summary_json: customerMessageSummary,
          created_by: reviewer,
        })
        .select('id')
        .single();

      if (customerUpdateError) throw customerUpdateError;

      // Complete billing with claim retry so transient claim desync does not fail approval.
      await completeBillingWithClaim({
        orderId: order.id,
        claimId,
        userId,
        claim,
        isResolvingFlags: false,
      });

      const approvedAt = new Date().toISOString();
      void sendPickerReadyNotification({
        eventType: 'order_ready_to_pick',
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        priority: order.priority,
        approvedAt,
      }).catch(() => { /* silent */ });

      void sendInternalNotification({
        eventType: 'order_update_for_sales',
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        salespersonName: order.salesperson_name,
        messageBody: customerMessageText,
        billingCustomerUpdateId: (customerUpdateRow as { id: number }).id,
      }).catch((e) => {
        console.error('order_update_for_sales', e);
        toast.error(
          `Sales notification failed: ${formatInternalNotificationError(e)}`,
        );
      });

      return reportSnapshot;
    },
    onSuccess: (snapshot) => {
      billingReportSnapshotRef.current = snapshot;
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', snapshot.orderId] });
      queryClient.invalidateQueries({ queryKey: ['stock_locationwise'] });

      // Move to report screen
      flow.finishBilling();
    },
    onError: () => {
      toast.error('Failed to approve order');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (reason: string) => {
      if (!order) throw new Error('No order selected');

      const trimmedReason = reason.trim();
      if (!trimmedReason) throw new Error('Rejection reason is required');

      const { error: updateError } = await supabase
        .from('orders')
        .update({
          workflow_status: 'rejected',
          notes: trimmedReason,
        })
        .eq('id', order.id);

      if (updateError) throw updateError;

      await sendInternalNotification({
        eventType: 'order_update_for_sales',
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        salespersonName: order.salesperson_name,
        messageBody: `Billing rejected order ${order.order_number}. Reason: ${trimmedReason}`,
      }).catch((e) => {
        console.error('order_update_for_sales', e);
        toast.error(
          `Sales notification failed: ${formatInternalNotificationError(e)}`,
        );
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['stock_locationwise'] });
      if (order) {
        queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      }
      toast.success('Order rejected and salesperson notified');
      void handleSkip();
    },
    onError: () => {
      toast.error('Failed to reject order');
    },
  });

  // ── Urgent interrupt banner ──
  const urgentBanner = hasUrgentInterrupt ? (
    <div className="ds-card border-2 border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] mx-4 mt-3 mb-0 animate-slide-up">
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
      o => o.id !== completedOrderId && (!o.claim_info || o.is_mine)
    );

    if (remainingOrders.length > 0) {
      const next = remainingOrders[0];
      setCurrentOrderId(next.id);
      flow.openOrder();
    } else {
      flow.nextOrder();
    }
  }, [claimId, userId, release, queue, effectiveOrderId, flow]);

  // ══════════════════════════════════════════
  //  VIEW ROUTING
  // ══════════════════════════════════════════

  if (flow.state === 'queue') {
    return (
      <QueueView
        available={available}
        otherActive={otherActive}
        stale={stale}
        myActive={myActive}
        isLoading={queueLoading}
        onSelect={(orderId) => {
          setCurrentOrderId(orderId);
          flow.openOrder();
        }}
        onTakeover={(orderId) => {
          setCurrentOrderId(orderId);
          flow.openOrder();
        }}
      />
    );
  }

  if (flow.state === 'orderSheet') {
    if (!order || orderLoading) {
      return <div className="min-h-screen bg-[var(--bg-primary)] animate-pulse" />;
    }

    return (
      <>
        {urgentBanner}
        <OrderSheetView
          orderName={order.customer_name}
          orderNumber={order.order_number}
          salesperson={order.salesperson_name}
          customerAddress={order.customer_address ?? null}
          notes={order.notes}
          city={order.customer_city}
          itemCount={order.item_count}
          totalValue={order.total_value}
          priority={order.priority}
          createdAt={order.created_at}
          items={items}
          flags={flow.flags}
          isClaiming={!isClaimedByMe}
          isApproving={approveMutation.isPending}
          isRejecting={rejectMutation.isPending}
          onFlagNoStock={flow.flagNoStock}
          onFlagPartial={flow.flagPartial}
          onClearFlag={flow.clearFlag}
          onFinish={() => {
            if (!isClaimedByMe || approveMutation.isPending || rejectMutation.isPending) return;
            approveMutation.mutate();
          }}
          onReject={(reason) => rejectMutation.mutate(reason)}
          onSkip={handleSkip}
        />
      </>
    );
  }

  if (flow.state === 'report') {
    const snap = billingReportSnapshotRef.current;
    const completedId = snap?.orderId ?? effectiveOrderId;
    return (
      <ReportView
        orderName={snap?.orderName ?? order?.customer_name ?? 'Order'}
        orderNumber={snap?.orderNumber ?? order?.order_number ?? ''}
        salesperson={snap?.salesperson ?? order?.salesperson_name ?? null}
        items={snap?.items ?? items}
        flags={flow.flags}
        totalWaiting={Math.max(0, queue.filter(o => (!o.claim_info || o.is_mine) && o.id !== completedId).length)}
        onNext={handleNext}
      />
    );
  }

  return <div />;
}
