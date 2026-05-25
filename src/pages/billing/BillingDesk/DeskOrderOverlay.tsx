import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Check,
  FileText,
  Flag,
  Receipt,
  Trash,
  X,
} from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrderDetail } from '../../../hooks/useOrderDetail';
import { useWorkClaim } from '../../../hooks/useWorkClaim';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { supabase } from '../../../lib/supabase/client';
import { completeBillingWithClaim } from '../../../lib/billing/completeBilling';
import { shouldNotifyPickers } from '../../../lib/billing/fulfillmentPath';
import { canBroadcastReadyToPick } from '../../../lib/billing/pickerNotifyPolicy';
import { sendPickerReadyNotification } from '../../../lib/pickerPush';
import { formatCurrencyRaw, orderItemDisplayName } from '../../../utils/formatters';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import type { OrderItem } from '../../../types';
import { CHANGE_REASON_OPTIONS, type ChangeReason, type OverlayLineEdit } from './types';

interface DeskOrderOverlayProps {
  order: DeskOrderRow;
  flaggedMode: boolean;
  onClose: () => void;
}

function initEdits(items: OrderItem[]): Record<number, OverlayLineEdit> {
  const edits: Record<number, OverlayLineEdit> = {};
  for (const item of items) {
    edits[item.id] = {
      priceQuoted: item.price_quoted ?? item.price_system ?? 0,
      removed: false,
      priceTouched: false,
    };
  }
  return edits;
}

export function DeskOrderOverlay({
  order,
  flaggedMode,
  onClose,
}: DeskOrderOverlayProps): React.JSX.Element {
  const { data: orderDetail, isLoading } = useOrderDetail(order.id);

  return (
    <div
      className="absolute inset-0 z-10 flex items-start justify-center p-4 bg-[rgba(0,0,0,0.60)]"
      onClick={onClose}
      role="presentation"
    >
      {isLoading || !orderDetail ? (
        <div
          className="w-full max-w-[540px] h-48 rounded-xl bg-[var(--bg-secondary)] animate-pulse"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <DeskOrderOverlayEditor
          key={order.id}
          order={order}
          orderDetail={orderDetail}
          flaggedMode={flaggedMode}
          onClose={onClose}
        />
      )}
    </div>
  );
}

interface DeskOrderOverlayEditorProps {
  order: DeskOrderRow;
  orderDetail: NonNullable<ReturnType<typeof useOrderDetail>['data']>;
  flaggedMode: boolean;
  onClose: () => void;
}

function DeskOrderOverlayEditor({
  order,
  orderDetail,
  flaggedMode,
  onClose,
}: DeskOrderOverlayEditorProps): React.JSX.Element {
  const { userId, userName } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { claimId, isClaimedByMe, claim } = useWorkClaim(
    order.workflow_status === 'submitted' ? order.id : null,
    'billing',
  );

  const items = orderDetail.items;
  const [edits, setEdits] = useState(() => initEdits(items));
  const [reason, setReason] = useState<ChangeReason>('no_changes');
  const [pendingRemoveId, setPendingRemoveId] = useState<number | null>(null);
  const [step, setStep] = useState<'idle' | 'saved' | 'notified'>('idle');

  useEffect(() => {
    if (order.workflow_status !== 'submitted' || isClaimedByMe) return;
    void claim();
  }, [order.workflow_status, isClaimedByMe, claim]);

  const visibleItems = useMemo(
    () => items.filter((i) => !edits[i.id]?.removed),
    [items, edits],
  );

  const total = useMemo(
    () =>
      visibleItems.reduce((acc, item) => {
        const edit = edits[item.id];
        const price = edit?.priceQuoted ?? item.price_quoted ?? item.price_system ?? 0;
        return acc + price * item.qty_requested;
      }, 0),
    [visibleItems, edits],
  );

  const primaryFlagItem = useMemo(
    () => items.find((i) => i.state === 'flagged'),
    [items],
  );

  const notifyPickerAllowed = useMemo(
    () =>
      canBroadcastReadyToPick(orderDetail.workflow_status) &&
      shouldNotifyPickers(orderDetail.fulfillment_path ?? 'warehouse_pick'),
    [orderDetail.fulfillment_path, orderDetail.workflow_status],
  );

  const updatePrice = useCallback((itemId: number, price: number) => {
    setEdits((prev) => ({
      ...prev,
      [itemId]: {
        ...prev[itemId]!,
        priceQuoted: Math.max(0, price),
        priceTouched: true,
      },
    }));
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orderDetail || !userId) throw new Error('Order not loaded');

      const reviewer = userName ?? 'Billing';
      const nowIso = new Date().toISOString();
      const resolvingFlags =
        orderDetail.workflow_status === 'flagged' ||
        (flaggedMode && items.some((i) => i.state === 'flagged'));

      for (const item of items) {
        const edit = edits[item.id];
        if (!edit || edit.removed) {
          await supabase.from('order_items').delete().eq('id', item.id);
          continue;
        }

        const patch: Record<string, unknown> = {
          price_quoted: edit.priceQuoted,
        };

        if (resolvingFlags && item.state === 'flagged') {
          patch.state = 'picked';
          patch.flag_reason = null;
          patch.flag_notes = null;
          patch.flag_box_price = null;
        }

        await supabase.from('order_items').update(patch).eq('id', item.id);
      }

      const nextItemCount = visibleItems.length;
      await supabase
        .from('orders')
        .update({
          item_count: nextItemCount,
          total_value: total,
          notes:
            reason !== 'no_changes'
              ? `[Billing desk] ${CHANGE_REASON_OPTIONS.find((o) => o.value === reason)?.label ?? reason}`
              : orderDetail.notes,
        })
        .eq('id', orderDetail.id);

      if (orderDetail.workflow_status === 'submitted') {
        if (!claimId && !isClaimedByMe) {
          const claimResult = await claim();
          if (!claimResult.success || !claimResult.claim_id) {
            throw new Error('Could not claim order for billing');
          }
        }

        await completeBillingWithClaim({
          orderId: orderDetail.id,
          claimId: claimId,
          userId,
          claim,
          isResolvingFlags: false,
          fulfillmentPath: 'warehouse_pick',
        });
      } else if (resolvingFlags) {
        await completeBillingWithClaim({
          orderId: orderDetail.id,
          claimId: null,
          userId,
          claim,
          isResolvingFlags: true,
          fulfillmentPath: 'direct_bill',
        });
      } else {
        await supabase
          .from('orders')
          .update({
            reviewer_name: reviewer,
            approved_at: orderDetail.approved_at ?? nowIso,
          })
          .eq('id', orderDetail.id);
      }
    },
    onSuccess: () => {
      setStep('saved');
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      toast.success('Bill saved ✓');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save bill');
    },
  });

  const notifyMutation = useMutation({
    mutationFn: async () => {
      if (!orderDetail) throw new Error('No order');
      if (!notifyPickerAllowed) {
        throw new Error('Order is no longer waiting in the pick queue');
      }
      await sendPickerReadyNotification({
        eventType: 'order_ready_to_pick',
        orderId: orderDetail.id,
        orderNumber: orderDetail.order_number,
        customerName: orderDetail.customer_name,
        priority: orderDetail.priority,
        approvedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      setStep('notified');
      toast.success('Picker notified — on their way');
      window.setTimeout(() => onClose(), 1600);
    },
    onError: () => {
      toast.error('Failed to notify picker');
    },
  });

  const headerFlagTitle = primaryFlagItem?.flag_reason ?? 'Item needs review';

  return (
    <div
      className="w-full max-w-[540px] max-h-[628px] flex flex-col rounded-xl bg-[var(--bg-secondary)] overflow-hidden shadow-lg"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="desk-overlay-title"
    >
        <header
          className={`shrink-0 flex items-start gap-2.5 px-4 py-3 ${
            flaggedMode
              ? 'bg-[var(--bg-warning-subtle)]'
              : 'bg-[var(--bg-tertiary)]'
          }`}
        >
          {flaggedMode ? (
            <Flag size={18} weight="fill" className="text-[var(--content-warning-on-light)] shrink-0 mt-0.5" />
          ) : (
            <FileText size={18} className="text-[var(--content-quaternary)] shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <h2
              id="desk-overlay-title"
              className={`text-[13px] font-medium ${
                flaggedMode ? 'text-[var(--content-warning)]' : 'text-[var(--content-primary)]'
              }`}
            >
              {flaggedMode ? headerFlagTitle : order.order_number}
            </h2>
            <p
              className={`text-[11px] mt-0.5 ${
                flaggedMode ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-quaternary)]'
              }`}
            >
              {flaggedMode
                ? `Flagged by ${order.picker_name ?? 'picker'} · ${order.order_number}`
                : 'Edit MRP · Save & Bill · Notify picker'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[var(--content-quaternary)] hover:bg-[var(--bg-secondary)]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          <div className="rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 flex justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-[var(--content-primary)] truncate">
                {orderDetail.customer_name}
              </p>
              <p className="text-[10px] text-[var(--content-quaternary)] mt-0.5">
                {orderDetail.picker_name ? `Picker: ${orderDetail.picker_name}` : 'No picker yet'}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[15px] font-medium tabular-nums">{formatCurrencyRaw(total)}</p>
              <p className="text-[10px] text-[var(--content-quaternary)]">{visibleItems.length} items</p>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--content-quaternary)] mb-1.5">
              Line items — edit MRP or remove
            </p>
            <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
              <div className="grid grid-cols-[1fr_50px_78px_38px] gap-0 bg-[var(--bg-tertiary)] px-2.5 py-1.5 text-[9px] font-semibold uppercase text-[var(--content-quaternary)]">
                <span>Item</span>
                <span>Qty</span>
                <span>MRP</span>
                <span />
              </div>
              {items.map((item) => {
                    const edit = edits[item.id];
                    if (!edit || edit.removed) return null;
                    const isFlaggedRow = item.state === 'flagged';
                    return (
                      <div
                        key={item.id}
                        className={`grid grid-cols-[1fr_50px_78px_38px] gap-0 px-2.5 py-2 border-t border-[var(--border-faint)] items-center ${
                          isFlaggedRow
                            ? 'bg-[var(--bg-warning-subtle)] border-l-2 border-l-[var(--border-warning)]'
                            : ''
                        }`}
                      >
                        <div className="min-w-0 pr-1">
                          <p className="text-xs text-[var(--content-primary)] truncate">
                            {orderItemDisplayName(item)}
                          </p>
                          {isFlaggedRow && (
                            <span className="inline-block mt-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)] border border-[var(--border-warning)]">
                              Flagged
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-[var(--content-quaternary)] tabular-nums">
                          {item.qty_requested}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={edit.priceQuoted}
                          onChange={(e) =>
                            updatePrice(item.id, parseFloat(e.target.value.replace(/,/g, '')) || 0)
                          }
                          className={`w-[68px] h-7 px-1.5 text-xs rounded-md border tabular-nums ${
                            edit.priceTouched
                              ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
                              : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)]'
                          }`}
                        />
                        <div className="flex flex-col items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (pendingRemoveId === item.id) {
                                setEdits((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id]!, removed: true },
                                }));
                                setPendingRemoveId(null);
                              } else {
                                setPendingRemoveId(item.id);
                              }
                            }}
                            className="text-[var(--content-quaternary)] hover:text-[var(--content-negative)]"
                            aria-label="Remove line"
                          >
                            <Trash size={13} />
                          </button>
                          {pendingRemoveId === item.id && (
                            <button
                              type="button"
                              onClick={() => {
                                setEdits((prev) => ({
                                  ...prev,
                                  [item.id]: { ...prev[item.id]!, removed: true },
                                }));
                                setPendingRemoveId(null);
                              }}
                              className="text-[9px] text-[var(--content-negative)]"
                            >
                              Remove?
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

          <div>
            <label
              htmlFor="desk-change-reason"
              className="text-[10px] font-semibold uppercase tracking-wide text-[var(--content-quaternary)]"
            >
              Reason for any changes
            </label>
            <select
              id="desk-change-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as ChangeReason)}
              className="mt-1 w-full h-9 px-2 text-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]"
            >
              {CHANGE_REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <footer className="shrink-0 px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-tertiary)] space-y-1.5">
          <div className="flex items-center gap-2.5">
            <StepCircle
              state={step === 'idle' ? 'active' : 'done'}
              number={1}
            />
            <button
              type="button"
              disabled={saveMutation.isPending || step !== 'idle'}
              onClick={() => saveMutation.mutate()}
              className={`flex-1 h-10 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-2 ${
                step !== 'idle'
                  ? 'bg-[var(--bg-positive-subtle)] border border-[var(--border-positive)] text-[var(--content-positive)] cursor-default'
                  : 'bg-[var(--bg-positive)] text-white hover:opacity-95 disabled:opacity-50'
              }`}
            >
              {step !== 'idle' ? (
                <>
                  <Check size={16} weight="bold" />
                  Bill saved ✓
                </>
              ) : (
                <>
                  <Receipt size={16} weight="bold" />
                  Save & Bill
                </>
              )}
            </button>
          </div>
          <div className="flex items-center gap-2.5">
            <StepCircle
              state={
                !notifyPickerAllowed
                  ? 'waiting'
                  : step === 'saved'
                    ? 'active'
                    : step === 'notified'
                      ? 'done'
                      : 'waiting'
              }
              number={2}
            />
            {notifyPickerAllowed ? (
              <button
                type="button"
                disabled={
                  step === 'idle' ||
                  step === 'notified' ||
                  notifyMutation.isPending ||
                  saveMutation.isPending
                }
                onClick={() => notifyMutation.mutate()}
                className={`flex-1 h-10 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-2 ${
                  step === 'notified'
                    ? 'bg-[var(--bg-positive-subtle)] border border-[var(--border-positive)] text-[var(--content-positive)] cursor-default'
                    : step === 'saved'
                      ? 'bg-[var(--bg-positive)] text-white hover:opacity-95'
                      : 'bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-[var(--content-quaternary)] cursor-not-allowed'
                }`}
              >
                {step === 'notified' ? (
                  <>
                    <Check size={16} weight="bold" />
                    Picker notified — on their way
                  </>
                ) : (
                  <>
                    <Bell size={16} weight="bold" />
                    Notify picker — collect bill
                  </>
                )}
              </button>
            ) : (
              <p className="flex-1 text-[11px] text-[var(--content-quaternary)] leading-snug">
                {orderDetail.workflow_status === 'picking' ||
                orderDetail.workflow_status === 'completed'
                  ? 'Pick already started or done — no new queue alert needed.'
                  : 'Notify picker is only for orders waiting in the pick queue.'}
              </p>
            )}
          </div>
        </footer>
    </div>
  );
}

function StepCircle({
  state,
  number,
}: {
  state: 'active' | 'done' | 'waiting';
  number: number;
}): React.JSX.Element {
  if (state === 'done') {
    return (
      <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center bg-[var(--bg-positive-subtle)] border border-[var(--border-positive)] text-[var(--content-positive)] shrink-0">
        <Check size={12} weight="bold" />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center bg-[var(--bg-positive)] text-white text-xs font-semibold shrink-0">
        {number}
      </span>
    );
  }
  return (
    <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-[var(--content-quaternary)] text-xs shrink-0">
      {number}
    </span>
  );
}
