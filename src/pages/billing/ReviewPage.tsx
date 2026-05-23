import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, CheckCircle, XCircle, Hourglass, Warning, Printer } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase/client';
import {
  formatInternalNotificationError,
  sendInternalNotification,
  sendPickerReadyNotification,
} from '../../lib/pickerPush';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { useWorkClaim } from '../../hooks/useWorkClaim';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  PageHeader,
  Card,
  StatusBadge,
  NumberStepper,
  BigButton,
  BottomSheet,
  BillingApproverChip,
  PickerAttributionChip,
} from '../../components/shared';
import { openPickingChalanPrint } from '../../lib/billing/printPickingChalan';
import type { OrderItem, PendingItem } from '../../types';
import { formatCurrency, formatTimestamp, formatTimeAgo } from '../../utils/formatters';
import { isFocOrderItem } from '../../lib/specialPricing';
import { buildBillingCustomerUpdate } from '../../lib/buildBillingCustomerUpdate';
import { invalidateLocationwiseStockQueries } from '../../hooks/useLocationwiseStock';

interface EditableItem extends OrderItem {
  qty_approved: number;
}

type PendingDraftRow = {
  order_id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  item_id: number;
  item_name: string;
  qty_pending: number;
  source: 'billing' | 'sales';
  created_by: string;
  note: string;
};

type FinalBillingLineState = {
  qtyBilled: number;
  qtyPending: number;
  pendingSource: 'billing' | 'sales' | null;
  pendingNote: string | null;
  shouldFlagBillingPending: boolean;
};

type PriceResolutionChoice = 'accept_box_price' | 'override_invoice_price';

function deriveFinalBillingLineState(
  item: EditableItem,
  isMarkedPending: boolean,
): FinalBillingLineState {
  const rawPending = Math.max(
    Math.max(0, item.qty_po ?? 0),
    Math.max(0, item.qty_requested - item.qty_approved),
    isMarkedPending ? Math.max(0, item.qty_approved) : 0,
  );
  const qtyPending = Math.min(item.qty_requested, rawPending);
  const qtyBilled = isMarkedPending
    ? 0
    : Math.max(0, Math.min(item.qty_approved, item.qty_requested - qtyPending));

  if (qtyPending <= 0) {
    return {
      qtyBilled,
      qtyPending: 0,
      pendingSource: null,
      pendingNote: null,
      shouldFlagBillingPending: false,
    };
  }

  return {
    qtyBilled,
    qtyPending,
    pendingSource: isMarkedPending ? 'billing' : 'sales',
    pendingNote: isMarkedPending
      ? 'Marked pending by billing (no stock in Busy)'
      : 'Purchase order qty from sales checkout',
    shouldFlagBillingPending: isMarkedPending,
  };
}

export default function ReviewPage(): React.JSX.Element | null {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userName, userId } = useAuth();

  const orderId = id ? parseInt(id, 10) : null;
  const { data: order, isLoading, error } = useOrderDetail(orderId);

  // Initialize work claim
  const { claimId, isClaimedByMe, claim, error: claimError } = useWorkClaim(
    orderId,
    'billing'
  );

  // Auto-claim if submitted
  useEffect(() => {
    if (order?.workflow_status === 'submitted' && !isClaimedByMe && !claimError) {
      claim();
    }
  }, [order?.workflow_status, isClaimedByMe, claim, claimError]);

  const [items, setItems] = useState<EditableItem[]>([]);
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [rejectSheetOpen, setRejectSheetOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [priceResolutionByItemId, setPriceResolutionByItemId] = useState<
    Record<number, PriceResolutionChoice | null>
  >({});
  const rejectNavigateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync items from order when loaded
  useEffect(() => {
    if (order?.items) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(
        order.items.map((i) => {
          let approved =
            i.qty_approved ?? i.qty_shippable ?? i.qty_requested;
          if (i.qty_shippable != null) {
            const floor = i.qty_shippable === 0 ? 0 : 1;
            approved = Math.min(
              i.qty_shippable,
              Math.max(floor, approved),
            );
          }
          return { ...i, qty_approved: approved };
        }),
      );
      setRemovedIds(new Set());
      setPendingIds(
        new Set(
          order.items
            .filter(
              (i) =>
                i.state === 'flagged' &&
                (i.flag_reason === 'Out of Stock' ||
                  i.flag_reason === 'Out of Stock (Billing)'),
            )
            .map((i) => i.id),
        ),
      );
      setPriceResolutionByItemId(
        Object.fromEntries(
          order.items
            .filter(
              (i) =>
                i.flag_reason === 'Price Mismatch' &&
                !isFocOrderItem(i),
            )
            .map((i) => [i.id, null]),
        ),
      );
    }
  }, [order?.id, order?.items]);

  // Cleanup reject navigate timeout on unmount
  useEffect(() => {
    return () => {
      if (rejectNavigateTimeoutRef.current) {
        clearTimeout(rejectNavigateTimeoutRef.current);
      }
    };
  }, []);

  const visibleItems = items.filter((i) => !removedIds.has(i.id));

  const pendingCount = useMemo(() => {
    let count = 0;
    for (const id of pendingIds) {
      if (!removedIds.has(id)) count += 1;
    }
    return count;
  }, [pendingIds, removedIds]);

  const priceMismatchCount = useMemo(
    () =>
      visibleItems.filter(
        (item) =>
          Boolean(item.flag_reason && item.flag_reason === 'Price Mismatch') &&
          !isFocOrderItem(item),
      ).length,
    [visibleItems],
  );

  const readyToBillCount = useMemo(
    () => Math.max(0, visibleItems.length - pendingCount - priceMismatchCount),
    [visibleItems.length, pendingCount, priceMismatchCount],
  );

  const unresolvedPriceMismatchCount = useMemo(
    () =>
      visibleItems.filter(
        (item) =>
          item.flag_reason === 'Price Mismatch' &&
          !isFocOrderItem(item) &&
          !priceResolutionByItemId[item.id],
      ).length,
    [priceResolutionByItemId, visibleItems],
  );

  const { totalQty, grandTotal } = useMemo(() => {
    let qty = 0;
    let total = 0;
    for (const item of visibleItems) {
      const finalState = deriveFinalBillingLineState(item, pendingIds.has(item.id));
      const price = item.price_quoted ?? item.price_system ?? 0;
      qty += finalState.qtyBilled;
      total += finalState.qtyBilled * price;
    }
    return { totalQty: qty, grandTotal: total };
  }, [pendingIds, visibleItems]);

  const busyItemCount = visibleItems.length;

  const pickingSummary = useMemo(() => {
    if (!order?.items) {
      return null;
    }
    const totalLines = order.items.length;
    let picked = 0;
    let flagged = 0;
    for (const i of order.items) {
      if (i.state === 'picked') picked += 1;
      else if (i.state === 'flagged') flagged += 1;
    }
    const done = picked + flagged;
    const remaining = Math.max(0, totalLines - done);
    return {
      totalLines,
      picked,
      flagged,
      remaining,
      done,
    };
  }, [order]);

  const updateQty = useCallback((itemId: number, qty: number) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== itemId) return i;
        const floor = i.qty_shippable === 0 ? 0 : 1;
        let next = Math.max(floor, qty);
        if (i.qty_shippable != null) {
          next = Math.min(i.qty_shippable, next);
        }
        return { ...i, qty_approved: next };
      }),
    );
  }, []);

  const removeItem = useCallback((itemId: number) => {
    setRemovedIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
    setPendingIds((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  const togglePending = useCallback((itemId: number) => {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const updatePrice = useCallback((itemId: number, price: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId ? { ...i, price_quoted: Math.max(0, price) } : i
      )
    );
  }, []);

  const choosePriceResolution = useCallback(
    (item: EditableItem, choice: PriceResolutionChoice) => {
      setPriceResolutionByItemId((prev) => ({ ...prev, [item.id]: choice }));
      if (choice === 'accept_box_price' && typeof item.flag_box_price === 'number') {
        updatePrice(item.id, item.flag_box_price);
      }
    },
    [updatePrice],
  );

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
      const reviewer = userName || 'Billing';
      const resolvingFlags = order.workflow_status === 'flagged';
      if (resolvingFlags) {
        const unresolved = visibleItems.find(
          (item) =>
            item.state === 'flagged' &&
            item.flag_reason === 'Price Mismatch' &&
            !priceResolutionByItemId[item.id],
        );
        if (unresolved) {
          throw new Error('Resolve all price mismatch lines before completing billing.');
        }
      }
      const approvedAt = new Date().toISOString();
      const billingPendingItemIds: number[] = [];
      const pendingDraftsByItemId = new Map<number, PendingDraftRow>();

      // Update each remaining item's qty_approved (and price / flags)
      for (const item of visibleItems) {
        const finalState = deriveFinalBillingLineState(item, pendingIds.has(item.id));
        const update: Record<string, unknown> = {
          qty_approved: finalState.qtyBilled,
          qty_shippable: finalState.qtyBilled,
          qty_po: finalState.qtyPending,
        };
        // Allow billing to override price when resolving flags
        if (typeof item.price_quoted === 'number') {
          update.price_quoted = item.price_quoted;
        }
        // When resolving picking flags, clear the flag and mark as picked
        if (resolvingFlags && item.state === 'flagged') {
          update.state = 'picked';
          update.flag_reason = null;
          update.flag_notes = null;
          update.flag_box_price = null;
        }

        await supabase
          .from('order_items')
          .update(update)
          .eq('id', item.id);

        if (finalState.qtyPending > 0 && finalState.pendingSource && finalState.pendingNote) {
          pendingDraftsByItemId.set(item.item_id, {
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
          });
        }

        if (finalState.shouldFlagBillingPending) {
          billingPendingItemIds.push(item.id);
        }
      }

      // Delete removed items
      for (const rid of removedIds) {
        await supabase.from('order_items').delete().eq('id', rid);
      }

      const { data: existingPendingRows, error: existingPendingError } = await supabase
        .from('pending_items')
        .select('*')
        .eq('order_id', order.id)
        .eq('status', 'pending')
        .returns<PendingItem[]>();
      if (existingPendingError) throw existingPendingError;

      const pendingRowsByItemId = new Map<number, PendingItem[]>();
      for (const row of existingPendingRows ?? []) {
        if (row.item_id == null) continue;
        const bucket = pendingRowsByItemId.get(row.item_id) ?? [];
        bucket.push(row);
        pendingRowsByItemId.set(row.item_id, bucket);
      }

      const pendingIdsToResolve = new Set<number>();
      const pendingRowsToInsert: PendingDraftRow[] = [];

      for (const [itemId, rows] of pendingRowsByItemId.entries()) {
        const desired = pendingDraftsByItemId.get(itemId);
        if (!desired) {
          for (const row of rows) pendingIdsToResolve.add(row.id);
          continue;
        }

        const sortedRows = [...rows].sort((a, b) => {
          if (a.source === 'sales' && b.source !== 'sales') return -1;
          if (b.source === 'sales' && a.source !== 'sales') return 1;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });

        const primary = sortedRows[0]!;
        const { error: updatePendingError } = await supabase
          .from('pending_items')
          .update({
            qty_pending: desired.qty_pending,
            source: primary.source === 'sales' ? 'sales' : desired.source,
            note: desired.note,
            status: 'pending',
            resolved_at: null,
            resolved_by: null,
            recovery_status: primary.source === 'sales' ? 'reviewed' : primary.recovery_status,
          })
          .eq('id', primary.id);
        if (updatePendingError) throw updatePendingError;

        for (const duplicate of sortedRows.slice(1)) {
          pendingIdsToResolve.add(duplicate.id);
        }

        pendingDraftsByItemId.delete(itemId);
      }

      for (const draft of pendingDraftsByItemId.values()) {
        pendingRowsToInsert.push(draft);
      }

      if (pendingIdsToResolve.size > 0) {
        const { error: resolvePendingError } = await supabase
          .from('pending_items')
          .update({
            status: 'resolved',
            resolved_at: approvedAt,
            resolved_by: reviewer,
          })
          .in('id', [...pendingIdsToResolve]);
        if (resolvePendingError) throw resolvePendingError;
      }

      if (pendingRowsToInsert.length > 0) {
        const { error: insertPendingError } = await supabase
          .from('pending_items')
          .insert(pendingRowsToInsert);
        if (insertPendingError) throw insertPendingError;
      }

      if (billingPendingItemIds.length > 0) {
        const { error: flagPendingError } = await supabase
          .from('order_items')
          .update({
            state: 'flagged',
            flag_reason: 'Out of Stock (Billing)',
          })
          .in('id', billingPendingItemIds);
        if (flagPendingError) throw flagPendingError;
      }

      if (!resolvingFlags) {
        const { messageText, summary } = buildBillingCustomerUpdate({
          orderNumber: order.order_number,
          customerName: order.customer_name,
          businessName: import.meta.env.VITE_BUSINESS_DISPLAY_NAME,
          date: new Date(),
          lines: visibleItems.map((item) => {
            const finalState = deriveFinalBillingLineState(item, pendingIds.has(item.id));
            return {
              itemId: item.item_id,
              name: item.item_name,
              qtyRequested: item.qty_requested,
              qtyBilled: finalState.qtyBilled,
              qtyPending: finalState.qtyPending,
            };
          }),
        });

        const { data: customerUpdateRow, error: updateInsertError } = await supabase
          .from('billing_customer_updates')
          .insert({
            order_id: order.id,
            message_text: messageText,
            summary_json: summary,
            created_by: reviewer,
          })
          .select('id')
          .single();
        if (updateInsertError) throw updateInsertError;

        try {
          await sendInternalNotification({
            eventType: 'order_update_for_sales',
            orderId: order.id,
            orderNumber: order.order_number,
            customerName: order.customer_name,
            salespersonName: order.salesperson_name,
            messageBody: messageText,
            billingCustomerUpdateId: (customerUpdateRow as { id: number }).id,
          });
        } catch (notifyError) {
          console.error('order_update_for_sales', notifyError);
          toast.error(
            `Sales notification failed: ${formatInternalNotificationError(notifyError)}`,
          );
        }
      }

      // Run the complete_billing RPC if we have an active claim
      if (claimId && userId) {
        const { error: rpcError } = await supabase.rpc('complete_billing', {
          p_order_id: order.id,
          p_claim_id: claimId,
          p_user_id: userId,
          p_is_resolving_flags: resolvingFlags,
        });
        if (rpcError) throw rpcError;
      } else {
        // Fallback for orders without claims (e.g. already flagged or old records)
        const orderUpdate: Record<string, unknown> = {
          reviewer_name: reviewer,
          item_count: visibleItems.length,
          total_value: grandTotal,
        };

        if (resolvingFlags) {
          orderUpdate.workflow_status = 'completed';
          orderUpdate.priority = 'normal';
        } else {
          orderUpdate.workflow_status = 'approved';
          orderUpdate.approved_at = approvedAt;
        }

        await supabase.from('orders').update(orderUpdate).eq('id', order.id);
      }

      if (!resolvingFlags) {
        try {
          await sendPickerReadyNotification({
            eventType: 'order_ready_to_pick',
            orderId: order.id,
            orderNumber: order.order_number,
            customerName: order.customer_name,
            priority: order.priority,
            approvedAt,
          });
        } catch (pushError) {
          console.error('Failed to send picker push notification', pushError);
        }
      }

      if (order.order_kind === 'recovery') {
        const { error: resolveRecoveryError } = await supabase
          .from('pending_items')
          .update({
            status: 'resolved',
            resolved_at: approvedAt,
            resolved_by: reviewer,
            recovery_status: 'reviewed',
            recovery_reviewed_at: approvedAt,
            recovery_reviewed_by: reviewer,
          })
          .eq('recovery_order_id', order.id)
          .eq('status', 'pending');
        if (resolveRecoveryError) throw resolveRecoveryError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] });
      void invalidateLocationwiseStockQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['billing-customer-update', orderId] });
      toast.success(
        order?.workflow_status === 'flagged'
          ? 'Flags resolved and order marked completed'
          : 'Order approved and sent to picking'
      );
      navigate('/billing');
    },
    onError: (err) => {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Failed to approve order';
      toast.error(message);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
      await supabase
        .from('orders')
        .update({
          workflow_status: 'flagged',
          notes: rejectReason.trim() || 'Rejected by billing',
        })
        .eq('id', order.id);
    },
    onSuccess: () => {
      setRejectSheetOpen(false);
      const previousNotes = order?.notes ?? null;
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      void invalidateLocationwiseStockQueries(queryClient);
      toast.success('Order rejected', {
        action: {
          label: 'Undo',
          onClick: () => {
            if (rejectNavigateTimeoutRef.current) {
              clearTimeout(rejectNavigateTimeoutRef.current);
              rejectNavigateTimeoutRef.current = null;
            }
            supabase
              .from('orders')
              .update({
                workflow_status: 'submitted',
                notes: previousNotes,
              })
              .eq('id', order!.id)
              .then(() => {
                queryClient.invalidateQueries({ queryKey: ['orders'] });
                queryClient.invalidateQueries({ queryKey: ['order', orderId] });
                void invalidateLocationwiseStockQueries(queryClient);
                toast.success('Rejection undone');
              });
          },
        },
      });
      rejectNavigateTimeoutRef.current = setTimeout(() => {
        rejectNavigateTimeoutRef.current = null;
        navigate('/billing');
      }, 3000);
    },
    onError: () => {
      toast.error('Failed to reject order');
    },
  });

  const handleReject = () => {
    if (!rejectReason.trim()) {
      toast.error('Please provide a reason for rejection');
      return;
    }
    rejectMutation.mutate();
  };

  const canPrintPickingChalan =
    order != null &&
    ['approved', 'picking', 'completed', 'flagged'].includes(order.workflow_status);

  const handlePrintPickingChalan = useCallback(() => {
    if (!order) return;
    const opened = openPickingChalanPrint(order, order.items ?? items);
    if (!opened) {
      toast.error('Allow pop-ups to print the picking chalan.');
    }
  }, [order, items, toast]);

  if (!orderId) {
    navigate('/billing');
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <PageHeader
        title={order?.order_number ?? 'Review Order'}
        onBack={() => navigate('/billing')}
        action={
          canPrintPickingChalan ? (
            <button
              type="button"
              onClick={handlePrintPickingChalan}
              className="min-h-12 min-w-12 flex items-center justify-center rounded-lg text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              aria-label="Print picking chalan"
              title="Print picking chalan"
            >
              <Printer size={22} weight="bold" />
            </button>
          ) : undefined
        }
      />

      <div className="p-4 lg:px-8 lg:py-6 max-w-4xl mx-auto">
        {claimError && (
          <div className="mb-6 p-4 rounded-xl bg-[var(--bg-negative-subtle)] border-2 border-[var(--border-negative)] flex items-start gap-3">
            <XCircle size={24} className="text-[var(--content-negative)] mt-0.5 shrink-0" weight="fill" />
            <div>
              <h3 className="font-bold text-[var(--content-negative)]">Cannot review this order</h3>
              <p className="text-[var(--content-negative)] text-sm mt-1 opacity-90">{claimError}</p>
              <button 
                onClick={() => navigate('/billing')}
                className="mt-3 px-4 py-2 bg-[var(--bg-negative)] text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
              >
                Go back to dashboard
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-[var(--bg-tertiary)] rounded w-1/3" />
            <div className="h-24 bg-[var(--bg-tertiary)] rounded" />
            <div className="h-48 bg-[var(--bg-tertiary)] rounded" />
          </div>
        ) : error || !order ? (
          <p className="text-[var(--content-negative)]">Failed to load order</p>
        ) : (
          <>
            {/* Order info bar */}
            <Card className="mb-6 lg:mb-8">
              <div className="space-y-2 text-base lg:text-lg">
                <p className="font-bold text-[var(--content-primary)]">{order.customer_name}</p>
                {order.customer_city && (
                  <p className="text-[var(--content-secondary)]">{order.customer_city}</p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm lg:text-base text-[var(--content-secondary)]">
                  <span>Salesperson: {order.salesperson_name}</span>
                  {order.transport_name && (
                    <span>Transport: {order.transport_name}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <span className="font-mono text-[var(--content-secondary)]">
                    {order.order_number}
                  </span>
                  {order.order_kind === 'recovery' && (
                    <span className="inline-flex items-center rounded-full bg-[var(--bg-accent-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--bg-accent)]">
                      Recovery
                    </span>
                  )}
                  <StatusBadge status={order.workflow_status} />
                  {order.priority === 'urgent' && (
                    <StatusBadge status="urgent" />
                  )}
                  {order.reviewer_name && (
                    <BillingApproverChip name={order.reviewer_name} />
                  )}
                  {order.picker_name ? (
                    <PickerAttributionChip
                      name={order.picker_name}
                      active={order.workflow_status === 'picking'}
                    />
                  ) : (
                    (order.workflow_status === 'approved' ||
                      order.workflow_status === 'picking') && (
                      <span className="inline-flex items-center h-6 px-3 rounded-full border border-[var(--border-opaque)] bg-[var(--bg-tertiary)] text-xs font-semibold text-[var(--content-tertiary)]">
                        Waiting for picker
                      </span>
                    )
                  )}
                </div>
                {order.workflow_status === 'picking' && order.picker_name && (
                  <div className="mt-2 text-sm px-3 py-2 rounded-lg bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] font-semibold border border-[var(--border-warning)]">
                    Picking chalan: accepted by {order.picker_name}
                    {order.picked_at && (
                      <span className="font-normal opacity-90">
                        {' '}
                        · since {formatTimeAgo(order.picked_at)}
                      </span>
                    )}
                  </div>
                )}
                <p className="text-sm text-[var(--content-tertiary)]">
                  {formatTimestamp(order.created_at)}
                </p>
              </div>
            </Card>

            {/* Flag resolution banner */}
            {order.workflow_status === 'flagged' && (
              <Card className="mb-6 border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]">
                <div className="flex items-start gap-3">
                  <Warning className="text-[var(--content-warning)] mt-0.5" size={20} weight="fill" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-[var(--content-warning)]">
                      This order was flagged during picking
                      {order.picker_name && (
                        <span className="font-normal">
                          {' '}
                          by {order.picker_name}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-[var(--content-warning)]">
                      Review the flagged lines below, adjust prices/quantities if needed,
                      then mark the order as completed once Busy is updated.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* Picking progress (for approved / picking / completed orders) */}
            {pickingSummary &&
              (order.workflow_status === 'approved' ||
                order.workflow_status === 'picking' ||
                order.workflow_status === 'completed' ||
                order.workflow_status === 'flagged') && (
                <Card className="mb-6 lg:mb-8">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--content-primary)]">
                          Picking progress
                        </p>
                        {order.workflow_status === 'approved' && (
                          <p className="text-xs text-[var(--content-tertiary)] mt-0.5">
                            Waiting for picker
                          </p>
                        )}
                        {order.picker_name && order.workflow_status !== 'approved' && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <PickerAttributionChip
                              name={order.picker_name}
                              active={order.workflow_status === 'picking'}
                            />
                            {order.workflow_status === 'picking' && order.picked_at && (
                              <span className="text-xs text-[var(--content-tertiary)]">
                                since {formatTimeAgo(order.picked_at)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="text-sm font-mono text-[var(--content-secondary)] shrink-0">
                        {pickingSummary.done}/{pickingSummary.totalLines} items
                        done
                      </p>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--bg-positive)]"
                        style={{
                          width: `${
                            (pickingSummary.done /
                              Math.max(1, pickingSummary.totalLines)) *
                            100
                          }%`,
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-[var(--content-secondary)]">
                      <span className="font-mono">
                        Picked: {pickingSummary.picked}
                      </span>
                      <span className="font-mono">
                        Flagged: {pickingSummary.flagged}
                      </span>
                      {pickingSummary.remaining > 0 && (
                        <span className="font-mono">
                          Remaining: {pickingSummary.remaining}
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              )}

            {/* Item list */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-[var(--content-primary)]">Items</h2>
              <div className="space-y-3">
                {visibleItems.map((item) => {
                  const price = item.price_quoted ?? item.price_system ?? 0;
                  const finalState = deriveFinalBillingLineState(item, pendingIds.has(item.id));
                  const lineTotal = finalState.qtyBilled * price;
                  const isPending = pendingIds.has(item.id);
                  const shipCap = item.qty_shippable;
                  const poGap = finalState.qtyPending;
                  const showSplitLine =
                    poGap > 0 ||
                    (shipCap != null && shipCap < item.qty_requested);
                  return (
                  <Card
                    key={item.id}
                    className={`flex flex-col lg:flex-row lg:items-center gap-4 ${
                      isPending ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]' : ''
                    }`}
                  >
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-[var(--content-primary)] text-base lg:text-lg">
                            {item.item_name}
                          </p>
                          {isFocOrderItem(item) && (
                            <span className="inline-flex items-center rounded-full border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--content-positive)]">
                              FOC
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-[var(--content-secondary)] mt-1">
                          Requested: {item.qty_requested} · Unit: ₹
                          {price.toLocaleString('en-IN')}
                        </p>
                        {showSplitLine && (
                          <p className="text-xs text-[var(--content-tertiary)] mt-1">
                            {shipCap != null && shipCap > 0 ? `Bill now: ${shipCap}` : ''}
                            {shipCap != null && shipCap > 0 && poGap > 0 ? ' · ' : ''}
                            {poGap > 0 ? `PO: ${poGap}` : ''}
                          </p>
                        )}
                        {item.state === 'flagged' && (
                          <div className="mt-2 space-y-1 text-xs">
                            <div className="flex flex-wrap gap-2">
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] border border-[var(--border-warning)]">
                                <Warning size={12} weight="fill" />
                                {item.flag_reason || 'Flagged in picking'}
                              </span>
                              {typeof item.flag_box_price === 'number' &&
                                !Number.isNaN(item.flag_box_price) && (
                                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] border border-[var(--border-warning)]">
                                    Box price: ₹
                                    {item.flag_box_price.toLocaleString('en-IN', {
                                      maximumFractionDigits: 2,
                                    })}
                                  </span>
                                )}
                              {item.flag_notes && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] border border-[var(--border-warning)]">
                                  {item.flag_notes}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs text-[var(--content-secondary)]">
                                System price:
                              </span>
                              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[var(--bg-tertiary)] text-[var(--content-secondary)] border border-[var(--border-subtle)]">
                                ₹{(item.price_system ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                              </span>
                              <span className="text-xs text-[var(--content-secondary)]">
                                Invoice price (per unit):
                              </span>
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-[var(--content-tertiary)]">₹</span>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  step="0.01"
                                  min="0"
                                  value={item.price_quoted ?? item.price_system ?? 0}
                                  onChange={(e) =>
                                    updatePrice(
                                      item.id,
                                      Number.parseFloat(e.target.value || '0'),
                                    )
                                  }
                                  className="w-24 px-2 py-1 rounded-xl border border-[var(--border-opaque)] text-xs text-[var(--content-primary)] bg-[var(--bg-secondary)] min-h-11"
                                />
                              </div>
                            </div>
                            {item.flag_reason === 'Price Mismatch' && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    choosePriceResolution(item, 'accept_box_price')
                                  }
                                  className={`inline-flex items-center gap-1 h-7 pl-2 pr-3 rounded-full text-xs border ${
                                    priceResolutionByItemId[item.id] === 'accept_box_price'
                                      ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border-[var(--border-positive)]'
                                      : 'bg-[var(--bg-secondary)] text-[var(--content-secondary)] border-[var(--border-subtle)]'
                                  }`}
                                >
                                  Accept box price
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    choosePriceResolution(item, 'override_invoice_price')
                                  }
                                  className={`inline-flex items-center gap-1 h-7 pl-2 pr-3 rounded-full text-xs border ${
                                    priceResolutionByItemId[item.id] === 'override_invoice_price'
                                      ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border-[var(--border-positive)]'
                                      : 'bg-[var(--bg-secondary)] text-[var(--content-secondary)] border-[var(--border-subtle)]'
                                  }`}
                                >
                                  Keep override
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {isPending ? (
                          <button
                            type="button"
                            onClick={() => togglePending(item.id)}
                            className="inline-flex items-center gap-1 h-6 pl-2 pr-3 rounded-full text-xs font-semibold bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] border border-[var(--border-warning)]"
                          >
                            <Hourglass size={14} weight="bold" />
                            Pending (no stock)
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => togglePending(item.id)}
                            className="inline-flex items-center gap-1 h-6 pl-2 pr-3 rounded-full text-xs font-medium text-[var(--content-warning)] bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)] hover:bg-[var(--bg-warning-subtle)] transition-colors"
                          >
                            <Hourglass size={14} weight="bold" />
                            Mark as pending (no stock)
                          </button>
                        )}
                      </div>
                      </div>
                      <div className="flex items-center gap-3 lg:gap-4 shrink-0">
                        <NumberStepper
                          value={item.qty_approved}
                          onChange={(q) => updateQty(item.id, q)}
                          min={item.qty_shippable === 0 ? 0 : 1}
                          max={item.qty_shippable != null ? item.qty_shippable : undefined}
                          presets={[]}
                        />
                        <span className="font-mono font-semibold text-[var(--content-primary)] min-w-[88px] text-base lg:text-lg">
                          ₹{lineTotal.toLocaleString('en-IN')}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="min-h-12 min-w-12 flex items-center justify-center rounded-lg text-[var(--content-negative)] hover:bg-[var(--bg-negative-subtle)] transition-colors"
                          aria-label="Remove item"
                        >
                          <X size={22} weight="bold" />
                        </button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            {order.notes && (
              <div className="mt-6">
                <h2 className="text-lg font-semibold text-[var(--content-primary)] mb-2">
                  Notes
                </h2>
                <Card>
                  <p className="text-[var(--content-secondary)] whitespace-pre-wrap">
                    {order.notes}
                  </p>
                </Card>
              </div>
            )}

            {/* Summary */}
            <Card className="mt-6 lg:mt-8 border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Warning size={18} weight="fill" className="text-[var(--content-warning)]" />
                  <h2 className="text-sm font-semibold tracking-wide text-[var(--content-warning)] uppercase">
                    Review summary before billing
                  </h2>
                </div>
                <div className="space-y-2 text-sm text-[var(--content-primary)]">
                  <div className="flex items-center justify-between">
                    <div className="inline-flex items-center gap-2">
                      <CheckCircle size={16} weight="bold" className="text-[var(--content-positive)]" />
                      <span>Items ready to bill</span>
                    </div>
                    <span className="font-mono font-semibold text-[var(--content-positive)]">
                      {readyToBillCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="inline-flex items-center gap-2">
                      <Warning size={16} weight="bold" className="text-[var(--content-warning)]" />
                      <span>Price mismatches to review</span>
                    </div>
                    <span className="font-mono font-semibold text-[var(--content-warning)]">
                      {priceMismatchCount}
                    </span>
                  </div>
                  {unresolvedPriceMismatchCount > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="inline-flex items-center gap-2">
                        <Warning size={16} weight="bold" className="text-[var(--content-negative)]" />
                        <span>Price mismatches unresolved</span>
                      </div>
                      <span className="font-mono font-semibold text-[var(--content-negative)]">
                        {unresolvedPriceMismatchCount}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="inline-flex items-center gap-2">
                      <Hourglass size={16} weight="bold" className="text-[var(--content-secondary)]" />
                      <span>Items marked as pending</span>
                    </div>
                    <span className="font-mono font-semibold text-[var(--content-primary)]">
                      {pendingCount}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 pt-3 border-t border-[var(--border-warning)]">
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs text-[var(--content-secondary)]">Items (Busy)</p>
                      <p className="text-xl font-bold tabular-nums text-[var(--content-primary)]">
                        {busyItemCount}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--content-secondary)]">Total quantity</p>
                      <p className="text-base font-semibold tabular-nums text-[var(--content-secondary)]">
                        {totalQty}
                      </p>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-xs text-[var(--content-secondary)]">Grand total</p>
                    <p className="text-2xl lg:text-3xl font-bold font-mono text-[var(--content-primary)]">
                      {formatCurrency(grandTotal)}
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            {/* Actions */}
            <div className="mt-6 lg:mt-8 flex flex-col sm:flex-row gap-3">
              {canPrintPickingChalan && (
                <BigButton
                  variant="secondary"
                  onClick={handlePrintPickingChalan}
                  className="sm:flex-1"
                >
                  <Printer size={20} weight="bold" />
                  Print picking chalan
                </BigButton>
              )}
              {order.workflow_status === 'submitted' && (
                <>
                  <BigButton
                    variant="danger"
                    onClick={() => setRejectSheetOpen(true)}
                    className="sm:flex-1"
                  >
                    <XCircle size={20} weight="bold" />
                    Reject
                  </BigButton>
                  <BigButton
                    variant="primary"
                    onClick={() => approveMutation.mutate()}
                    loading={approveMutation.isPending}
                    className="sm:flex-[2] hover:opacity-90 bg-[var(--bg-positive)]"
                  >
                    <CheckCircle size={20} weight="bold" />
                    Approve & Send to Picking
                  </BigButton>
                </>
              )}
              {order.workflow_status === 'flagged' && (
                <BigButton
                  variant="primary"
                  onClick={() => approveMutation.mutate()}
                  loading={approveMutation.isPending}
                  disabled={unresolvedPriceMismatchCount > 0}
                  className="sm:flex-[2] hover:opacity-90 bg-[var(--bg-warning)]"
                >
                  <CheckCircle size={20} weight="bold" />
                  Confirm & Generate Bill
                </BigButton>
              )}
            </div>
          </>
        )}
      </div>

      {/* Reject reason sheet */}
      <BottomSheet
        isOpen={rejectSheetOpen}
        onClose={() => {
          setRejectSheetOpen(false);
          setRejectReason('');
        }}
        title="Reject order"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--content-secondary)]">
            Please provide a reason for rejecting this order.
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. Incorrect pricing, customer requested cancellation..."
            className="w-full h-24 px-4 py-3 rounded-xl border border-[var(--border-opaque)] text-[var(--content-primary)] placeholder-[var(--content-quaternary)] focus:outline-none focus:ring-2 focus:ring-[var(--role-primary)]"
            autoFocus
          />
          <BigButton
            variant="danger"
            onClick={handleReject}
            loading={rejectMutation.isPending}
          >
            Confirm Reject
          </BigButton>
        </div>
      </BottomSheet>

    </div>
  );
}
