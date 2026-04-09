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

import { useBillingFlowMachine } from '../../hooks/useBillingFlowMachine';
import { OrientView } from './LiveQueue/OrientView';
import { CommitView } from './LiveQueue/CommitView';
import { ProcessView } from './LiveQueue/ProcessView';
import { ResolveView } from './LiveQueue/ResolveView';
import { CommunicateView } from './LiveQueue/CommunicateView';
import { CompleteView } from './LiveQueue/CompleteView';
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

  // Sync active order logic
  useEffect(() => {
    if (myActive.length > 0 && currentOrderId !== myActive[0].id) {
      setCurrentOrderId(myActive[0].id);
    }
  }, [myActive, currentOrderId]);

  // Fallbacks: if nothing is actively claimed, just preview the first queue item.
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

  // 4. State Machine
  const machine = useBillingFlowMachine(items);

  // ── Handle pre-selection from URL on mount (after machine exists) ──
  const didConsumeParam = useRef(false);
  useEffect(() => {
    if (preSelectedOrderId && !didConsumeParam.current) {
      didConsumeParam.current = true;
      setCurrentOrderId(preSelectedOrderId);
      // Clear the param so refreshing doesn't re-trigger
      setSearchParams({}, { replace: true });
      // Jump straight to commit
      machine.startCommit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preSelectedOrderId]);

  // ── Urgent order detection ──
  // While working on a non-urgent order, check if an urgent one arrived
  const urgentInQueue = useMemo(
    () => queue.filter((o) => o.priority === 'urgent' && o.id !== effectiveOrderId),
    [queue, effectiveOrderId],
  );
  const hasUrgentInterrupt =
    urgentInQueue.length > 0 &&
    machine.state !== 'orient' &&
    activeInQueue?.priority !== 'urgent';

  // Track auto-claiming to avoid loops
  const claimAttempted = useRef<number | null>(null);

  // When crossing into the Commit phase, we fire the background claim
  useEffect(() => {
    if (
      machine.state === 'commit' &&
      effectiveOrderId &&
      !isClaimedByMe &&
      claimAttempted.current !== effectiveOrderId
    ) {
      claimAttempted.current = effectiveOrderId;
      claim();
    }
  }, [machine.state, effectiveOrderId, isClaimedByMe, claim]);

  // 5. Background Mutations

  // A. Skip / Release
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
    machine.reset();
  }, [claimId, userId, release, machine]);

  // ── Urgent interrupt: release current, jump to urgent ──
  const handleUrgentInterrupt = useCallback(async () => {
    const urgentOrder = urgentInQueue[0];
    if (!urgentOrder) return;

    // Release current claim gracefully
    if (claimId && userId) {
      try {
        await release();
      } catch {
        /* best effort */
      }
    }

    claimAttempted.current = null;
    machine.reset();
    // Set the urgent order as the current target and immediately commit
    setCurrentOrderId(urgentOrder.id);
    // Small delay to let state settle before entering commit
    setTimeout(() => machine.startCommit(), 50);
    toast.info(`Switching to urgent order: ${urgentOrder.customer_name}`);
  }, [urgentInQueue, claimId, userId, release, machine, toast]);

  // B. Park Order (Transition to Flagged)
  const parkMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
      await supabase
        .from('orders')
        .update({ workflow_status: 'flagged', notes: 'Parked by Billing operator for review' })
        .eq('id', order.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      toast.info(`Order ${order?.order_number} parked. Dropped from Live Queue.`);
      handleSkip();
    },
    onError: () => toast.error('Failed to park order'),
  });

  // C. Complete Billing (Approve)
  const approveMutation = useMutation({
    mutationFn: async (vars?: { salesDraftText?: string }) => {
      if (!order || !claimId || !userId) throw new Error('Cannot approve. Missing claim context.');
      const reviewer = userName || 'Billing';

      // Apply decisions from the machine tracking
      const finalItems = items.map((item, index) => {
        const decision = machine.decisions[item.id];
        const manualFlag = machine.manualFlags[index];
        let approvedQty = item.qty_shippable ?? item.qty_requested;

        if (decision === 'bill_available' || decision === 'bill_available_po_rest') {
          // Use manual flag qty if billing person flagged it, else fall back to db
          approvedQty = manualFlag?.availableQty ?? item.qty_shippable ?? 0;
        } else if (decision === 'drop_entirely') {
          approvedQty = 0;
        }

        return { ...item, approvedQty, decision };
      });

      // Update item quantities — billing only sets qty_approved.
      // Item state remains untouched; pickers handle state transitions.
      for (const item of finalItems) {
        const update: Record<string, unknown> = {
          qty_approved: item.approvedQty,
        };

        if (item.decision === 'drop_entirely') {
          update.qty_approved = 0;
        }

        await supabase.from('order_items').update(update).eq('id', item.id);

        // Handle PO tracking if requested
        if (item.decision === 'bill_available_po_rest') {
          const pendingVal = item.qty_requested - item.approvedQty;
          if (pendingVal > 0) {
            await supabase.from('pending_items').insert({
              order_id: order.id,
              order_number: order.order_number,
              customer_id: order.customer_id,
              customer_name: order.customer_name,
              item_id: item.item_id,
              item_name: item.item_name,
              qty_pending: pendingVal,
              source: 'billing',
              created_by: reviewer,
              note: 'Marked pending by billing (no stock in Busy)',
            });
          }
        }
      }

      // Execute Complete transition
      const { error: rpcError } = await supabase.rpc('complete_billing', {
        p_order_id: order.id,
        p_claim_id: claimId,
        p_user_id: userId,
        p_is_resolving_flags: false,
      });

      if (rpcError) throw rpcError;

      if (vars?.salesDraftText) {
        try {
          const notifyResult = await sendInternalNotification({
            eventType: 'order_update_for_sales',
            orderId: order.id,
            orderNumber: order.order_number,
            customerName: order.customer_name,
            salespersonName: order.salesperson_name,
            messageBody: vars.salesDraftText,
          });
          if (notifyResult?.inboxCount === 0) {
            toast.info(
              'No sales users in the database received this update. Check users.role = sales and is_active.',
            );
          }
        } catch (e) {
          console.error('order_update_for_sales', e);
          toast.error(
            `Sales notification failed: ${formatInternalNotificationError(e)}. Deploy send-internal-notification and run migration 014.`,
          );
        }
      }

      try {
        await sendPickerReadyNotification({
          eventType: 'order_ready_to_pick',
          orderId: order.id,
          orderNumber: order.order_number,
          customerName: order.customer_name,
          priority: order.priority,
          approvedAt: new Date().toISOString(),
        });
      } catch {
        // silent
      }

      return order.order_number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', effectiveOrderId] });

      // Moving to final closure state
      machine.confirmCommunication();
    },
    onError: () => {
      toast.error('Failed to approve order');
    },
  });

  // ── Urgent interrupt banner (rendered at top of process/commit/resolve views) ──
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

  // 6. Router Renderer

  if (machine.state === 'orient') {
    return (
      <OrientView
        queue={queue}
        totalWaiting={queue.length}
        isLoading={queueLoading}
        staleCount={stale.length}
        onStart={() => {
          if (activeInQueue) {
            setCurrentOrderId(activeInQueue.id);
            machine.startCommit();
          }
        }}
      />
    );
  }

  if (machine.state === 'commit') {
    if (!order || orderLoading)
      return <div className="min-h-screen bg-[var(--bg-primary)] animate-pulse" />;

    return (
      <>
        {urgentBanner}
        <CommitView
          orderName={order.customer_name}
          orderNumber={order.order_number}
          salesperson={order.salesperson_name}
          city={order.customer_city}
          itemCount={order.item_count}
          totalValue={order.total_value}
          priority={order.priority}
          createdAt={order.created_at}
          items={items}
          onCommit={machine.confirmCommit}
          onSkip={handleSkip}
          isClaiming={!isClaimedByMe}
        />
      </>
    );
  }

  if (machine.state === 'process') {
    if (!order) return <div />;
    return (
      <>
        {urgentBanner}
        <ProcessView
          orderName={order.customer_name}
          items={items}
          activeIndex={machine.activeItemIndex}
          isSubmitting={approveMutation.isPending}
          manualFlags={machine.manualFlags}
          onAdvance={machine.advanceProcessCursor}
          onJump={machine.jumpToItem}
          onFlag={machine.flagItem}
          onUnflag={machine.unflagItem}
          onFinish={() => {
            const hasIssues = machine.finishProcessPhase();
            if (!hasIssues) {
              approveMutation.mutate(undefined);
            }
          }}
        />
      </>
    );
  }

  if (machine.state === 'resolve') {
    if (!order || !machine.currentIssue) return <div />;
    const issueItem = items[machine.currentIssue.itemIndex];
    return (
      <>
        {urgentBanner}
        <ResolveView
          orderName={order.customer_name}
          item={issueItem}
          issue={machine.currentIssue}
          issueIndex={machine.activeIssueIndex}
          totalIssues={machine.issues.length}
          overrideAvailable={machine.manualFlags[machine.currentIssue.itemIndex]?.availableQty}
          onDecide={(decision) => machine.recordDecisionAndNext(issueItem.id, decision)}
          onPark={() => parkMutation.mutate()}
        />
      </>
    );
  }

  if (machine.state === 'communicate') {
    if (!order) return <div />;
    return (
      <CommunicateView
        orderNumber={order.order_number}
        orderName={order.customer_name}
        salesperson={order.salesperson_name}
        items={items}
        issues={machine.issues}
        decisions={machine.decisions}
        manualFlags={machine.manualFlags}
        isSubmitting={approveMutation.isPending}
        onSkip={() => approveMutation.mutate(undefined)}
        onSend={(draftText) => approveMutation.mutate({ salesDraftText: draftText })}
      />
    );
  }

  if (machine.state === 'complete') {
    return (
      <CompleteView
        orderName={order?.customer_name || 'Order'}
        totalWaiting={Math.max(0, queue.length - 1)}
        onAutoAdvance={handleSkip}
      />
    );
  }

  return <div />;
}
