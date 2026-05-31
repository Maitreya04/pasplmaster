import { useState, useMemo, useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, Hourglass, Warning, Printer } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase/client';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { usePickingClaim } from '../../hooks/usePickingClaim';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  PageHeader,
  Card,
  StatusBadge,
  BigButton,
  BottomSheet,
  BillingApproverChip,
  PickerAttributionChip,
} from '../../components/shared';
import { openPickingChalanPrint } from '../../lib/billing/printPickingChalan';
import type { FulfillmentPath } from '../../types';
import { formatCurrency, formatTimestamp, formatTimeAgo } from '../../utils/formatters';
import { invalidateLocationwiseStockQueries } from '../../hooks/useLocationwiseStock';
import {
  billingCompleteStalePicking,
  billingForceCompletePrePick,
  forceCompletePrePickErrorMessage,
  stalePickingCompleteErrorMessage,
} from '../../lib/billing/completeStalePicking';
import {
  defaultFulfillmentPath,
  fulfillmentPathLabel,
} from '../../lib/billing/fulfillmentPath';
import { FulfillmentPathSelector } from '../../components/billing/FulfillmentPathSelector';
import { ReviewBillSection } from '../../components/billing/ReviewBillSection';
import { useBillSheetEdits } from '../../hooks/useBillSheetEdits';
import type { OrderWithItems } from '../../types';
import {
  computePickLineProgress,
  countPickableOrderLines,
} from '../../lib/cartSupply';

export default function ReviewPage(): React.JSX.Element | null {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userName, userId } = useAuth();

  const orderId = id ? parseInt(id, 10) : null;
  const { data: order, isLoading, error } = useOrderDetail(orderId);
  const { data: pickingClaim } = usePickingClaim(
    orderId,
    order?.workflow_status === 'picking',
  );

  const [rejectSheetOpen, setRejectSheetOpen] = useState(false);
  const [stalePickConfirmOpen, setStalePickConfirmOpen] = useState(false);
  const [prePickConfirmOpen, setPrePickConfirmOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const rejectNavigateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fulfillmentPath, setFulfillmentPath] = useState<FulfillmentPath>('warehouse_pick');

  useEffect(() => {
    if (!orderId) {
      navigate('/billing/needs-review', { replace: true });
    }
  }, [orderId, navigate]);

  useEffect(() => {
    return () => {
      if (rejectNavigateTimeoutRef.current) {
        clearTimeout(rejectNavigateTimeoutRef.current);
      }
    };
  }, []);

  const pickLineCount = useMemo(
    () => countPickableOrderLines(order?.items ?? []),
    [order?.items],
  );

  useEffect(() => {
    if (!order) return;
    setFulfillmentPath(
      defaultFulfillmentPath(order.stock_location_code, order.pick_line_count ?? pickLineCount),
    );
  }, [order?.id, order?.stock_location_code, order?.pick_line_count, pickLineCount]);

  const pickingSummary = useMemo(() => {
    if (!order?.items) {
      return null;
    }
    const progress = computePickLineProgress(order.items);
    return {
      totalLines: progress.total,
      picked: progress.picked,
      flagged: progress.flagged,
      remaining: progress.remaining,
      done: progress.done,
    };
  }, [order?.items]);

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
        navigate('/billing/needs-review');
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

  const canCompleteStalePicking =
    order?.workflow_status === 'picking' &&
    (pickingClaim == null || pickingClaim.is_stale);

  const canForceCompletePrePick =
    order?.workflow_status === 'approved' &&
    order.fulfillment_path !== 'direct_bill';

  const completeStalePickingMutation = useMutation({
    mutationFn: async () => {
      if (!orderId || !userId) throw new Error('Not signed in');
      const result = await billingCompleteStalePicking({
        orderId,
        userId,
        userName: userName ?? null,
      });
      if (!result.success) {
        throw new Error(stalePickingCompleteErrorMessage(result));
      }
      return result;
    },
    onSuccess: (result) => {
      setStalePickConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['picking-claim', orderId] });
      toast.success(
        result.has_flags
          ? 'Order completed with flagged lines — review and generate bill'
          : 'Order marked completed',
      );
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to complete order');
    },
  });

  const forceCompletePrePickMutation = useMutation({
    mutationFn: async () => {
      if (!orderId || !userId) throw new Error('Not signed in');
      const result = await billingForceCompletePrePick({
        orderId,
        userId,
        userName: userName ?? null,
      });
      if (!result.success) {
        throw new Error(forceCompletePrePickErrorMessage(result));
      }
      return result;
    },
    onSuccess: () => {
      setPrePickConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      toast.success('Order completed without warehouse pick');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to complete order');
    },
  });

  const canPrintPickingChalan =
    order != null &&
    ['approved', 'picking', 'completed', 'flagged'].includes(order.workflow_status);

  const handlePrintPickingChalan = useCallback(() => {
    if (!order) return;
    const opened = openPickingChalanPrint(order, order.items ?? []);
    if (!opened) {
      toast.error('Allow pop-ups to print the picking chalan.');
    }
  }, [order, toast]);

  if (!orderId) {
    return null;
  }

  const handleBack = () => {
    navigate('/billing/needs-review');
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <PageHeader
        title={order?.order_number ?? 'Review Order'}
        onBack={handleBack}
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
        {isLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-[var(--bg-tertiary)] rounded w-1/3" />
            <div className="h-24 bg-[var(--bg-tertiary)] rounded" />
            <div className="h-48 bg-[var(--bg-tertiary)] rounded" />
          </div>
        ) : error || !order ? (
          <p className="text-[var(--content-negative)]">Failed to load order</p>
        ) : (
          <ReviewOrderContent
            order={order}
            fulfillmentPath={fulfillmentPath}
            setFulfillmentPath={setFulfillmentPath}
            pickLineCount={pickLineCount}
            pickingClaim={pickingClaim}
            pickingSummary={pickingSummary}
            canCompleteStalePicking={canCompleteStalePicking}
            canForceCompletePrePick={canForceCompletePrePick}
            onReject={() => setRejectSheetOpen(true)}
            onStalePickConfirm={() => setStalePickConfirmOpen(true)}
            onPrePickConfirm={() => setPrePickConfirmOpen(true)}
            onBack={handleBack}
          />
        )}
      </div>

      {/* Pre-pick force complete confirmation */}
      <BottomSheet
        isOpen={prePickConfirmOpen}
        onClose={() => setPrePickConfirmOpen(false)}
        title="Force complete without picking?"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--content-secondary)]">
            {order?.picker_name
              ? `${order.picker_name} has not finished (or started) warehouse picking. `
              : 'This order is still waiting for a picker. '}
            Mark it complete to bill directly and remove it from the pick queue.
          </p>
          <div className="flex gap-3">
            <BigButton
              variant="secondary"
              onClick={() => setPrePickConfirmOpen(false)}
              disabled={forceCompletePrePickMutation.isPending}
              className="flex-1"
            >
              Cancel
            </BigButton>
            <BigButton
              variant="primary"
              onClick={() => forceCompletePrePickMutation.mutate()}
              loading={forceCompletePrePickMutation.isPending}
              className="flex-[2] bg-[var(--bg-positive)]"
            >
              Confirm complete
            </BigButton>
          </div>
        </div>
      </BottomSheet>

      {/* Stale pick complete confirmation */}
      <BottomSheet
        isOpen={stalePickConfirmOpen}
        onClose={() => setStalePickConfirmOpen(false)}
        title="Complete stale pick?"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--content-secondary)]">
            {order?.picker_name
              ? `${order.picker_name}'s picking session has gone stale. `
              : 'The picking session has gone stale. '}
            Mark this order complete only if warehouse picking is finished.
          </p>
          {pickingSummary && pickingSummary.remaining > 0 && (
            <p className="text-sm text-[var(--content-warning)]">
              {pickingSummary.remaining} line
              {pickingSummary.remaining === 1 ? '' : 's'} still not picked or flagged.
            </p>
          )}
          <div className="flex gap-3">
            <BigButton
              variant="secondary"
              onClick={() => setStalePickConfirmOpen(false)}
              disabled={completeStalePickingMutation.isPending}
              className="flex-1"
            >
              Cancel
            </BigButton>
            <BigButton
              variant="primary"
              onClick={() => completeStalePickingMutation.mutate()}
              loading={completeStalePickingMutation.isPending}
              className="flex-[2] bg-[var(--bg-positive)]"
            >
              Confirm complete
            </BigButton>
          </div>
        </div>
      </BottomSheet>

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

interface ReviewOrderContentProps {
  order: OrderWithItems;
  fulfillmentPath: FulfillmentPath;
  setFulfillmentPath: Dispatch<SetStateAction<FulfillmentPath>>;
  pickLineCount: number;
  pickingClaim: ReturnType<typeof usePickingClaim>['data'];
  pickingSummary: {
    totalLines: number;
    picked: number;
    flagged: number;
    remaining: number;
    done: number;
  } | null;
  canCompleteStalePicking: boolean;
  canForceCompletePrePick: boolean;
  onReject: () => void;
  onStalePickConfirm: () => void;
  onPrePickConfirm: () => void;
  onBack: () => void;
}

function ReviewOrderContent({
  order,
  fulfillmentPath,
  setFulfillmentPath,
  pickLineCount,
  pickingClaim,
  pickingSummary,
  canCompleteStalePicking,
  canForceCompletePrePick,
  onReject,
  onStalePickConfirm,
  onPrePickConfirm,
  onBack,
}: ReviewOrderContentProps): React.JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();

  const billSheet = useBillSheetEdits({
    orderDetail: order,
    flaggedMode: order.workflow_status === 'flagged',
    fulfillmentPath,
    orderIdForClaim: order.id,
    onSaved: () => navigate('/billing/needs-review'),
  });

  const { claimError } = billSheet;

  const reviewBusyItemCount = billSheet.visibleItems.length;
  const reviewGrandTotal = billSheet.total;
  const reviewPriceMismatchCount = billSheet.flaggedItems.filter(
    (i) => i.flag_reason === 'Price Mismatch',
  ).length;
  const reviewUnresolvedPriceCount = billSheet.unresolvedFlagged.length;
  const pendingCount = billSheet.resolvedFlagged.filter((item) => {
    const edit = billSheet.edits[item.id];
    return edit?.resolution === 'removed';
  }).length;
  const reviewReadyCount = Math.max(
    0,
    reviewBusyItemCount - reviewPriceMismatchCount - pendingCount,
  );
  const totalQty = billSheet.visibleItems.reduce(
    (sum, item) => sum + item.qty_requested,
    0,
  );
  const billSavePending = billSheet.saveMutation.isPending;

  const canPrintPickingChalan =
    ['approved', 'picking', 'completed', 'flagged'].includes(order.workflow_status);

  const handlePrintPickingChalan = useCallback(() => {
    const opened = openPickingChalanPrint(order, order.items ?? []);
    if (!opened) {
      toast.error('Allow pop-ups to print the picking chalan.');
    }
  }, [order, toast]);

  return (
    <>
      {claimError ? (
        <div className="mb-6 p-4 rounded-xl bg-[var(--bg-negative-subtle)] border-2 border-[var(--border-negative)] flex items-start gap-3">
          <XCircle size={24} className="text-[var(--content-negative)] mt-0.5 shrink-0" weight="fill" />
          <div>
            <h3 className="font-bold text-[var(--content-negative)]">Cannot review this order</h3>
            <p className="text-[var(--content-negative)] text-sm mt-1 opacity-90">{claimError}</p>
            <button
              type="button"
              onClick={onBack}
              className="mt-3 px-4 py-2 bg-[var(--bg-negative)] text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
            >
              Back to needs review
            </button>
          </div>
        </div>
      ) : null}

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
                  {order.box_count != null && order.box_count >= 1 && (
                    <span className="inline-flex items-center h-6 px-3 rounded-full border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] text-xs font-semibold text-[var(--content-positive)]">
                      {order.box_count} box{order.box_count === 1 ? '' : 'es'} · ready to bill
                    </span>
                  )}
                </div>
                {order.workflow_status === 'picking' && order.picker_name && (
                  <div
                    className={`mt-2 text-sm px-3 py-2 rounded-lg font-semibold border ${
                      canCompleteStalePicking
                        ? 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] border-[var(--border-warning)]'
                        : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)] border-[var(--border-subtle)]'
                    }`}
                  >
                    Picking chalan: accepted by {order.picker_name}
                    {order.picked_at && (
                      <span className="font-normal opacity-90">
                        {' '}
                        · since {formatTimeAgo(order.picked_at)}
                      </span>
                    )}
                    {pickingClaim?.is_stale && (
                      <span className="block font-normal mt-1">
                        Picker session stale
                        {pickingClaim.last_heartbeat_at
                          ? ` (last active ${formatTimeAgo(pickingClaim.last_heartbeat_at)})`
                          : ''}
                        . Complete here if warehouse picking is done.
                      </span>
                    )}
                  </div>
                )}
                {canForceCompletePrePick && (
                  <div className="mt-2 text-sm px-3 py-2 rounded-lg font-semibold border bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] border-[var(--border-warning)]">
                    Waiting in the pick queue — no picker assigned yet.
                    <span className="block font-normal mt-1">
                      Force complete here to bill directly without warehouse picking.
                    </span>
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

            <ReviewBillSection order={order} billSheet={billSheet} />

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
                      {reviewReadyCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="inline-flex items-center gap-2">
                      <Warning size={16} weight="bold" className="text-[var(--content-warning)]" />
                      <span>Price mismatches to review</span>
                    </div>
                    <span className="font-mono font-semibold text-[var(--content-warning)]">
                      {reviewPriceMismatchCount}
                    </span>
                  </div>
                  {reviewUnresolvedPriceCount > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="inline-flex items-center gap-2">
                        <Warning size={16} weight="bold" className="text-[var(--content-negative)]" />
                        <span>Price mismatches unresolved</span>
                      </div>
                      <span className="font-mono font-semibold text-[var(--content-negative)]">
                        {reviewUnresolvedPriceCount}
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
                        {reviewBusyItemCount}
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
                      {formatCurrency(reviewGrandTotal)}
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            {order.workflow_status === 'submitted' && (
              <div className="mt-6 lg:mt-8">
                <FulfillmentPathSelector
                  value={fulfillmentPath}
                  onChange={setFulfillmentPath}
                  stockLocationCode={order.stock_location_code}
                  pickLineCount={pickLineCount}
                  disabled={billSavePending}
                />
              </div>
            )}

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
                    onClick={onReject}
                    className="sm:flex-1"
                  >
                    <XCircle size={20} weight="bold" />
                    Reject
                  </BigButton>
                  <BigButton
                    variant="primary"
                    onClick={() => billSheet.saveMutation.mutate()}
                    loading={billSheet.saveMutation.isPending}
                    disabled={billSheet.saveBlocked}
                    className="sm:flex-[2] hover:opacity-90 bg-[var(--bg-positive)]"
                  >
                    <CheckCircle size={20} weight="bold" />
                    Approve — {fulfillmentPathLabel(fulfillmentPath)}
                  </BigButton>
                </>
              )}
              {order.workflow_status === 'flagged' && (
                <BigButton
                  variant="primary"
                  onClick={() => billSheet.saveMutation.mutate()}
                  loading={billSheet.saveMutation.isPending}
                  disabled={billSheet.saveBlocked}
                  className="sm:flex-[2] hover:opacity-90 bg-[var(--bg-warning)]"
                >
                  <CheckCircle size={20} weight="bold" />
                  Confirm & Generate Bill
                </BigButton>
              )}
              {canForceCompletePrePick ? (
                <BigButton
                  variant="primary"
                  onClick={onPrePickConfirm}
                  className="sm:flex-[2] hover:opacity-90 bg-[var(--bg-positive)]"
                >
                  <CheckCircle size={20} weight="bold" />
                  Force complete (skip pick)
                </BigButton>
              ) : null}
              {canCompleteStalePicking ? (
                <BigButton
                  variant="primary"
                  onClick={onStalePickConfirm}
                  className={`sm:flex-[2] hover:opacity-90 ${
                    (pickingSummary?.flagged ?? 0) > 0
                      ? 'bg-[var(--bg-warning)] text-[var(--content-primary)]'
                      : 'bg-[var(--bg-positive)]'
                  }`}
                >
                  {(pickingSummary?.flagged ?? 0) > 0 ? (
                    <>
                      <Warning size={20} weight="bold" />
                      Complete with {pickingSummary?.flagged} flagged
                    </>
                  ) : (
                    <>
                      <CheckCircle size={20} weight="bold" />
                      Complete order
                    </>
                  )}
                </BigButton>
              ) : null}
            </div>
    </>
  );
}
