import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, CheckCircle, XCircle, Hourglass, Warning } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase/client';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  PageHeader,
  Card,
  StatusBadge,
  NumberStepper,
  BigButton,
  BottomSheet,
} from '../../components/shared';
import type { OrderItem } from '../../types';
import { formatCurrency, formatTimestamp } from '../../utils/formatters';

interface EditableItem extends OrderItem {
  qty_approved: number;
}

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userName } = useAuth();

  const orderId = id ? parseInt(id, 10) : null;
  const { data: order, isLoading, error } = useOrderDetail(orderId);

  const [items, setItems] = useState<EditableItem[]>([]);
  const [removedIds, setRemovedIds] = useState<Set<number>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [rejectSheetOpen, setRejectSheetOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const rejectNavigateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync items from order when loaded
  useEffect(() => {
    if (order?.items) {
      setItems(
        order.items.map((i) => ({
          ...i,
          qty_approved: i.qty_approved ?? i.qty_requested,
        }))
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
        (item) => item.flag_reason && item.flag_reason === 'Price Mismatch',
      ).length,
    [visibleItems],
  );

  const readyToBillCount = useMemo(
    () => Math.max(0, visibleItems.length - pendingCount - priceMismatchCount),
    [visibleItems.length, pendingCount, priceMismatchCount],
  );

  const { totalItems, grandTotal } = useMemo(() => {
    let count = 0;
    let total = 0;
    for (const item of visibleItems) {
      const price = item.price_quoted ?? item.price_system ?? 0;
      count += item.qty_approved;
      total += item.qty_approved * price;
    }
    return { totalItems: count, grandTotal: total };
  }, [visibleItems]);

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
  }, [order?.items]);

  const updateQty = useCallback((itemId: number, qty: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId ? { ...i, qty_approved: Math.max(1, qty) } : i
      )
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

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
      const reviewer = userName || 'Billing';
      const resolvingFlags = order.status === 'flagged';

      // Update each remaining item's qty_approved (and price / flags)
      for (const item of visibleItems) {
        const update: Record<string, unknown> = {
          qty_approved: item.qty_approved,
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
      }

      // Delete removed items
      for (const rid of removedIds) {
        await supabase.from('order_items').delete().eq('id', rid);
      }

      // Create pending entries for items that billing marked as "no stock"
      const pendingItemIds = Array.from(pendingIds).filter(
        (id) => !removedIds.has(id),
      );

      if (pendingItemIds.length > 0) {
        const pendingRows = visibleItems
          .filter((item) => pendingItemIds.includes(item.id))
          .map((item) => ({
            order_id: order.id,
            order_number: order.order_number,
            customer_id: order.customer_id,
            customer_name: order.customer_name,
            item_id: item.item_id,
            item_name: item.item_name,
            qty_pending: item.qty_approved,
            source: 'billing' as const,
            created_by: reviewer,
            note: 'Marked pending by billing (no stock in Busy)',
          }));

        if (pendingRows.length > 0) {
          await supabase.from('pending_items').insert(pendingRows);

          // Also mark these items as flagged (Out of Stock) so pickers see them as done + problem
          await supabase
            .from('order_items')
            .update({
              state: 'flagged',
              flag_reason: 'Out of Stock (Billing)',
            })
            .in('id', pendingItemIds);
        }
      }

      // Update order
      const orderUpdate: Record<string, unknown> = {
        reviewer_name: reviewer,
        item_count: visibleItems.length,
        total_value: grandTotal,
      };

      if (resolvingFlags) {
        // Picker already completed; billing is just resolving flags
        orderUpdate.status = 'completed';
        // Once the order is fully completed, clear any urgent priority
        orderUpdate.priority = 'normal';
      } else {
        orderUpdate.status = 'approved';
        orderUpdate.approved_at = new Date().toISOString();
      }

      await supabase.from('orders').update(orderUpdate).eq('id', order.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      toast.success(
        order?.status === 'flagged'
          ? 'Flags resolved and order marked completed'
          : 'Order approved and sent to picking'
      );
      navigate('/billing');
    },
    onError: () => {
      toast.error('Failed to approve order');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
      await supabase
        .from('orders')
        .update({
          status: 'flagged',
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
                status: 'submitted',
                notes: previousNotes,
              })
              .eq('id', order!.id)
              .then(() => {
                queryClient.invalidateQueries({ queryKey: ['orders'] });
                queryClient.invalidateQueries({ queryKey: ['order', orderId] });
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

  if (!orderId) {
    navigate('/billing');
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <PageHeader
        title={order?.order_number ?? 'Review Order'}
        onBack={() => navigate('/billing')}
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
                <div className="flex items-center gap-3 pt-2">
                  <span className="font-mono text-[var(--content-secondary)]">
                    {order.order_number}
                  </span>
                  <StatusBadge status={order.status} />
                  {order.priority === 'urgent' && (
                    <StatusBadge status="urgent" />
                  )}
                </div>
                <p className="text-sm text-[var(--content-tertiary)]">
                  {formatTimestamp(order.created_at)}
                </p>
              </div>
            </Card>

            {/* Flag resolution banner */}
            {order.status === 'flagged' && (
              <Card className="mb-6 border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]">
                <div className="flex items-start gap-3">
                  <Warning className="text-[var(--content-warning)] mt-0.5" size={20} weight="fill" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-[var(--content-warning)]">
                      This order was flagged during picking
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
              (order.status === 'approved' ||
                order.status === 'picking' ||
                order.status === 'completed') && (
                <Card className="mb-6 lg:mb-8">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[var(--content-primary)]">
                        Picking progress
                      </p>
                      <p className="text-sm font-mono text-[var(--content-secondary)]">
                        {pickingSummary.done}/{pickingSummary.totalLines} lines
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
                  const lineTotal = item.qty_approved * price;
                  const isPending = pendingIds.has(item.id);
                  return (
                  <Card
                    key={item.id}
                    className={`flex flex-col lg:flex-row lg:items-center gap-4 ${
                      isPending ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]' : ''
                    }`}
                  >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[var(--content-primary)] text-base lg:text-lg">
                          {item.item_name}
                        </p>
                        <p className="text-sm text-[var(--content-secondary)] mt-1">
                          Requested: {item.qty_requested} · Unit: ₹
                          {price.toLocaleString('en-IN')}
                        </p>
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
                              <span className="text-[11px] text-[var(--content-secondary)]">
                                Invoice price (per unit):
                              </span>
                              <div className="flex items-center gap-1">
                                <span className="text-[11px] text-[var(--content-tertiary)]">₹</span>
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
                                  className="w-24 px-2 py-1 rounded-md border border-[var(--border-opaque)] text-[11px] text-[var(--content-primary)] bg-[var(--bg-secondary)]"
                                />
                              </div>
                            </div>
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
                          min={1}
                          presets={[]}
                        />
                        <span className="font-mono font-semibold text-[var(--content-primary)] min-w-[88px] text-base lg:text-lg">
                          ₹{lineTotal.toLocaleString('en-IN')}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-lg text-[var(--content-negative)] hover:bg-[var(--bg-negative-subtle)] transition-colors"
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
                <div className="flex justify-between items-center pt-3 border-t border-[var(--border-warning)]">
                  <div>
                    <p className="text-xs text-[var(--content-secondary)]">Total items (qty)</p>
                    <p className="text-xl font-bold tabular-nums text-[var(--content-primary)]">
                      {totalItems}
                    </p>
                  </div>
                  <div className="text-right">
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
                className={`sm:flex-[2] hover:opacity-90 ${
                  order.status === 'flagged'
                    ? 'bg-[var(--bg-warning)]'
                    : 'bg-[var(--bg-positive)]'
                }`}
              >
                <CheckCircle size={20} weight="bold" />
                {order.status === 'flagged'
                  ? 'Confirm & Generate Bill'
                  : 'Approve & Send to Picking'}
              </BigButton>
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
