import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, CheckCircle, XCircle } from '@phosphor-icons/react';
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

function formatCurrency(n: number) {
  return n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
}

function formatTimestamp(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

  const updateQty = useCallback((itemId: number, qty: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === itemId ? { ...i, qty_approved: Math.max(1, qty) } : i
      )
    );
  }, []);

  const removeItem = useCallback((itemId: number) => {
    setRemovedIds((prev) => new Set(prev).add(itemId));
  }, []);

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
      const reviewer = userName || 'Billing';

      // Update each remaining item's qty_approved
      for (const item of visibleItems) {
        await supabase
          .from('order_items')
          .update({ qty_approved: item.qty_approved })
          .eq('id', item.id);
      }

      // Delete removed items
      for (const rid of removedIds) {
        await supabase.from('order_items').delete().eq('id', rid);
      }

      // Update order
      await supabase
        .from('orders')
        .update({
          status: 'approved',
          reviewer_name: reviewer,
          approved_at: new Date().toISOString(),
          item_count: visibleItems.length,
          total_value: grandTotal,
        })
        .eq('id', order.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      toast.success('Order approved and sent to picking');
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
    <div className="min-h-screen bg-[var(--navy-50)]">
      <PageHeader
        title={order?.order_number ?? 'Review Order'}
        onBack={() => navigate('/billing')}
      />

      <div className="p-4 lg:px-8 lg:py-6 max-w-4xl mx-auto">
        {isLoading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-slate-200 rounded w-1/3" />
            <div className="h-24 bg-slate-200 rounded" />
            <div className="h-48 bg-slate-200 rounded" />
          </div>
        ) : error || !order ? (
          <p className="text-red-600">Failed to load order</p>
        ) : (
          <>
            {/* Order info bar */}
            <Card className="mb-6 lg:mb-8">
              <div className="space-y-2 text-base lg:text-lg">
                <p className="font-bold text-slate-900">{order.customer_name}</p>
                {order.customer_city && (
                  <p className="text-slate-600">{order.customer_city}</p>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm lg:text-base text-slate-600">
                  <span>Salesperson: {order.salesperson_name}</span>
                  {order.transport_name && (
                    <span>Transport: {order.transport_name}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <span className="font-mono text-slate-600">
                    {order.order_number}
                  </span>
                  <StatusBadge status={order.status} />
                  {order.priority === 'urgent' && (
                    <StatusBadge status="urgent" />
                  )}
                </div>
                <p className="text-sm text-slate-500">
                  {formatTimestamp(order.created_at)}
                </p>
              </div>
            </Card>

            {/* Item list */}
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-800">Items</h2>
              <div className="space-y-3">
                {visibleItems.map((item) => {
                  const price = item.price_quoted ?? item.price_system ?? 0;
                  const lineTotal = item.qty_approved * price;
                  return (
                    <Card key={item.id} className="flex flex-col lg:flex-row lg:items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 text-base lg:text-lg">
                          {item.item_name}
                        </p>
                        <p className="text-sm text-slate-600 mt-1">
                          Requested: {item.qty_requested} · Unit: ₹
                          {price.toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 lg:gap-4 shrink-0">
                        <NumberStepper
                          value={item.qty_approved}
                          onChange={(q) => updateQty(item.id, q)}
                          min={1}
                          presets={[]}
                        />
                        <span className="font-mono font-semibold text-slate-800 min-w-[90px] text-base lg:text-lg">
                          ₹{lineTotal.toLocaleString('en-IN')}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 transition-colors"
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
                <h2 className="text-lg font-semibold text-slate-800 mb-2">
                  Notes
                </h2>
                <Card>
                  <p className="text-slate-700 whitespace-pre-wrap">
                    {order.notes}
                  </p>
                </Card>
              </div>
            )}

            {/* Summary */}
            <Card className="mt-6 lg:mt-8">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-slate-600">Total items</p>
                  <p className="text-xl font-bold tabular-nums text-slate-900">
                    {totalItems}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-600">Grand total</p>
                  <p className="text-2xl lg:text-3xl font-bold font-mono text-slate-900">
                    {formatCurrency(grandTotal)}
                  </p>
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
                className="sm:flex-[2] bg-emerald-600 hover:opacity-90"
              >
                <CheckCircle size={20} weight="bold" />
                Approve & Send to Picking
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
          <p className="text-sm text-slate-600">
            Please provide a reason for rejecting this order.
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. Incorrect pricing, customer requested cancellation..."
            className="w-full h-24 px-4 py-3 rounded-xl border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
