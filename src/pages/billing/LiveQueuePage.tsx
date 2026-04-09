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

import { useBillingFlow } from '../../hooks/useBillingFlow';
import { QueueView } from './LiveQueue/QueueView';
import { OrderSheetView } from './LiveQueue/OrderSheetView';
import { ReportView } from './LiveQueue/ReportView';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';

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
  const { available, myActive, stale, isLoading: queueLoading } = useClaimableOrders({
    stage: 'billing',
    workflowStatus: 'submitted',
  });

  const queue = useMemo(
    () => sortByUrgencyAndAge([...myActive, ...available, ...stale]),
    [myActive, available, stale],
  );

  const [currentOrderId, setCurrentOrderId] = useState<number | null>(null);

  // Sync active order if we already have a claim
  useEffect(() => {
    if (myActive.length > 0 && currentOrderId !== myActive[0].id) {
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
  }, [claimId, userId, release, flow]);

  // ── Urgent interrupt ──
  const handleUrgentInterrupt = useCallback(async () => {
    const urgentOrder = urgentInQueue[0];
    if (!urgentOrder) return;

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
  }, [urgentInQueue, claimId, userId, release, flow, toast]);

  // ── Complete Billing (Approve) — simplified from flags only ──
  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!order || !claimId || !userId) throw new Error('Cannot approve. Missing claim context.');
      const reviewer = userName || 'Billing';

      // Apply flags directly: no flag = full qty, partial = availableQty, no_stock = 0
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const flag = flow.flags[i];

        let approvedQty = item.qty_requested;

        if (flag?.type === 'no_stock') {
          approvedQty = 0;
        } else if (flag?.type === 'partial' && flag.availableQty != null) {
          approvedQty = flag.availableQty;
        }

        // Update qty_approved
        await supabase.from('order_items').update({
          qty_approved: approvedQty,
        }).eq('id', item.id);

        // Create pending item for shortfall
        const pendingQty = item.qty_requested - approvedQty;
        if (pendingQty > 0) {
          await supabase.from('pending_items').insert({
            order_id: order.id,
            order_number: order.order_number,
            customer_id: order.customer_id,
            customer_name: order.customer_name,
            item_id: item.item_id,
            item_name: item.item_name,
            qty_pending: pendingQty,
            source: 'billing',
            created_by: reviewer,
            note: flag?.type === 'no_stock'
              ? 'No stock in Busy — fully pending'
              : `Partial stock — ${approvedQty} billed, ${pendingQty} pending`,
          });
        }
      }

      // Execute complete_billing RPC
      const { error: rpcError } = await supabase.rpc('complete_billing', {
        p_order_id: order.id,
        p_claim_id: claimId,
        p_user_id: userId,
        p_is_resolving_flags: false,
      });

      if (rpcError) throw rpcError;

      // Send notifications
      try {
        await sendPickerReadyNotification({
          eventType: 'order_ready_to_pick',
          orderId: order.id,
          orderNumber: order.order_number,
          customerName: order.customer_name,
          priority: order.priority,
          approvedAt: new Date().toISOString(),
        });
      } catch { /* silent */ }

      // Send sales notification if there were flags
      if (flow.hasFlags) {
        try {
          // Build a summary for the internal notification
          const flagSummary = Object.entries(flow.flags).map(([idx, flag]) => {
            const item = items[Number(idx)];
            if (flag.type === 'no_stock') {
              return `${item.item_name}: No stock, ${item.qty_requested} pending`;
            }
            return `${item.item_name}: ${flag.availableQty} of ${item.qty_requested} billed, rest pending`;
          }).join('; ');

          await sendInternalNotification({
            eventType: 'order_update_for_sales',
            orderId: order.id,
            orderNumber: order.order_number,
            customerName: order.customer_name,
            salespersonName: order.salesperson_name,
            messageBody: `Billing update for ${order.order_number}: ${flagSummary}`,
          });
        } catch (e) {
          console.error('order_update_for_sales', e);
          toast.error(
            `Sales notification failed: ${formatInternalNotificationError(e)}`,
          );
        }
      }

      return order.order_number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', effectiveOrderId] });

      // Move to report screen
      flow.finishBilling();
    },
    onError: () => {
      toast.error('Failed to approve order');
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
    if (claimId && userId) {
      try {
        await release();
      } catch { /* best effort */ }
    }
    claimAttempted.current = null;
    setCurrentOrderId(null);

    // If there are more orders, auto-claim next
    const remainingOrders = queue.filter(
      o => o.id !== effectiveOrderId && (!o.claim_info || o.is_mine)
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
        queue={queue}
        isLoading={queueLoading}
        onSelect={(orderId) => {
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
          city={order.customer_city}
          itemCount={order.item_count}
          totalValue={order.total_value}
          priority={order.priority}
          createdAt={order.created_at}
          items={items}
          flags={flow.flags}
          isClaiming={!isClaimedByMe}
          isApproving={approveMutation.isPending}
          onFlagNoStock={flow.flagNoStock}
          onFlagPartial={flow.flagPartial}
          onClearFlag={flow.clearFlag}
          onFinish={() => approveMutation.mutate()}
          onSkip={handleSkip}
        />
      </>
    );
  }

  if (flow.state === 'report') {
    return (
      <ReportView
        orderName={order?.customer_name || 'Order'}
        orderNumber={order?.order_number || ''}
        salesperson={order?.salesperson_name || null}
        items={items}
        flags={flow.flags}
        totalWaiting={Math.max(0, queue.filter(o => (!o.claim_info || o.is_mine) && o.id !== effectiveOrderId).length)}
        onNext={handleNext}
      />
    );
  }

  return <div />;
}
