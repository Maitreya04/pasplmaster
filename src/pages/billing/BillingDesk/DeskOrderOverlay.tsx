import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  FileText,
  Flag,
  Receipt,
  X,
} from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrderDetail } from '../../../hooks/useOrderDetail';
import { usePendingItems } from '../../../hooks/usePendingItems';
import { useWorkClaim } from '../../../hooks/useWorkClaim';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { supabase } from '../../../lib/supabase/client';
import { completeBillingWithClaim } from '../../../lib/billing/completeBilling';
import { ensurePendingItem } from '../../../lib/billing/ensurePendingItem';
import {
  deskLineFlagKind,
  deskLineIssueCategory,
  formatDeskFlagSummarySubtitle,
  summarizeDeskFlags,
} from '../../../lib/billing/deskLineFlagKind';
import {
  indexPendingItemsByItemId,
  isDeskFlagLineAlreadyOnPo,
} from '../../../lib/billing/deskPoCoverage';
import { shouldNotifyPickers } from '../../../lib/billing/fulfillmentPath';
import { canBroadcastReadyToPick } from '../../../lib/billing/pickerNotifyPolicy';
import { pickQuantityTarget } from '../../../lib/cartSupply';
import { sendPickerReadyNotification } from '../../../lib/pickerPush';
import { formatCurrencyRaw } from '../../../utils/formatters';
import {
  groupOrderItemsForDisplay,
  orderItemSplitBatchCount,
} from '../../../lib/billing/orderItemSplitGroups';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import type { OrderItem } from '../../../types';
import { DeskFlaggedLineRow, DeskFlaggedSectionHeader, DeskNormalLineRow } from './DeskFlaggedLineRow';
import {
  CHANGE_REASON_OPTIONS,
  type ChangeReason,
  type OverlayLineEdit,
  type OverlayLineResolution,
} from './types';

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
      resolution: null,
    };
  }
  return edits;
}

function isFlaggedUnresolved(item: OrderItem, edit: OverlayLineEdit | undefined): boolean {
  return item.state === 'flagged' && edit != null && edit.resolution == null && !edit.removed;
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
  const { data: pendingItems = [] } = usePendingItems({
    orderId: orderDetail.id,
    status: 'pending',
  });
  const pendingByItemId = useMemo(
    () => indexPendingItemsByItemId(pendingItems),
    [pendingItems],
  );
  const [edits, setEdits] = useState(() => initEdits(items));
  const [reason, setReason] = useState<ChangeReason>('no_changes');
  const [reasonTouched, setReasonTouched] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<number | null>(null);
  const [step, setStep] = useState<'idle' | 'saved' | 'notified'>('idle');
  const [undoRemoveId, setUndoRemoveId] = useState<number | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [resolvedSectionOpen, setResolvedSectionOpen] = useState(true);

  useEffect(() => {
    if (order.workflow_status !== 'submitted' || isClaimedByMe) return;
    void claim();
  }, [order.workflow_status, isClaimedByMe, claim]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const allFlaggedItems = useMemo(
    () => items.filter((i) => i.state === 'flagged'),
    [items],
  );

  const flaggedItems = useMemo(
    () =>
      allFlaggedItems.filter(
        (item) =>
          !isDeskFlagLineAlreadyOnPo(item, pendingByItemId.get(item.item_id) ?? []),
      ),
    [allFlaggedItems, pendingByItemId],
  );

  const flagSummary = useMemo(
    () => summarizeDeskFlags(flaggedItems.map((i) => i.flag_reason)),
    [flaggedItems],
  );

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

  const unresolvedFlagged = useMemo(
    () => flaggedItems.filter((i) => isFlaggedUnresolved(i, edits[i.id])),
    [flaggedItems, edits],
  );

  const resolvedFlagged = useMemo(
    () =>
      flaggedItems.filter((i) => {
        const edit = edits[i.id];
        return edit != null && edit.resolution != null;
      }),
    [flaggedItems, edits],
  );

  const nonFlaggedItems = useMemo(
    () => items.filter((i) => i.state !== 'flagged'),
    [items],
  );

  const resolvingFlags =
    orderDetail.workflow_status === 'flagged' ||
    flaggedMode ||
    flaggedItems.length > 0;

  const allFlagsResolved = unresolvedFlagged.length === 0;
  const saveBlocked = resolvingFlags && !allFlagsResolved;

  const notifyPickerAllowed = useMemo(
    () =>
      canBroadcastReadyToPick(orderDetail.workflow_status) &&
      shouldNotifyPickers(orderDetail.fulfillment_path ?? 'warehouse_pick'),
    [orderDetail.fulfillment_path, orderDetail.workflow_status],
  );

  const flaggedItemGroups = useMemo(
    () => groupOrderItemsForDisplay(flaggedItems),
    [flaggedItems],
  );
  const normalItemGroups = useMemo(
    () => groupOrderItemsForDisplay(nonFlaggedItems),
    [nonFlaggedItems],
  );

  const applyReasonFromResolution = useCallback((resolution: OverlayLineResolution) => {
    if (reasonTouched) return;
    if (resolution === 'removed') setReason('out_of_stock');
    else if (resolution === 'accept_price') setReason('old_stock_rate');
    else if (resolution === 'keep_quoted' || resolution === 'manual_override') {
      setReason('data_correction');
    }
  }, [reasonTouched]);

  const patchEdit = useCallback(
    (itemId: number, patch: Partial<OverlayLineEdit>) => {
      setEdits((prev) => ({
        ...prev,
        [itemId]: { ...prev[itemId]!, ...patch },
      }));
    },
    [],
  );

  const updatePrice = useCallback(
    (itemId: number, price: number, item: OrderItem) => {
      const quoted = item.price_quoted ?? item.price_system ?? 0;
      const nextPrice = Math.max(0, price);
      const resolution: OverlayLineResolution | null =
        item.state === 'flagged'
          ? nextPrice === quoted
            ? 'keep_quoted'
            : 'manual_override'
          : null;
      patchEdit(itemId, {
        priceQuoted: nextPrice,
        priceTouched: true,
        resolution: item.state === 'flagged' ? resolution : null,
      });
      if (resolution === 'manual_override') applyReasonFromResolution('manual_override');
      else if (resolution === 'keep_quoted') applyReasonFromResolution('keep_quoted');
    },
    [patchEdit, applyReasonFromResolution],
  );

  const acceptBoxPrice = useCallback(
    (item: OrderItem) => {
      const box =
        typeof item.flag_box_price === 'number' && !Number.isNaN(item.flag_box_price)
          ? item.flag_box_price
          : null;
      if (box == null) return;
      patchEdit(item.id, {
        priceQuoted: box,
        priceTouched: true,
        resolution: 'accept_price',
      });
      applyReasonFromResolution('accept_price');
    },
    [patchEdit, applyReasonFromResolution],
  );

  const keepQuoted = useCallback(
    (item: OrderItem) => {
      const edit = edits[item.id];
      const quoted = item.price_quoted ?? item.price_system ?? 0;
      const price = edit?.priceTouched ? edit.priceQuoted : quoted;
      const resolution: OverlayLineResolution =
        edit?.priceTouched && price !== quoted ? 'manual_override' : 'keep_quoted';
      patchEdit(item.id, {
        priceQuoted: price,
        priceTouched: edit?.priceTouched ?? false,
        resolution,
      });
      applyReasonFromResolution(resolution);
    },
    [edits, patchEdit, applyReasonFromResolution],
  );

  const removeFlaggedLine = useCallback(
    (item: OrderItem) => {
      patchEdit(item.id, {
        removed: true,
        resolution: 'removed',
      });
      applyReasonFromResolution('removed');
      setUndoRemoveId(item.id);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => setUndoRemoveId(null), 5000);
    },
    [patchEdit, applyReasonFromResolution],
  );

  const undoRemove = useCallback((itemId: number) => {
    patchEdit(itemId, {
      removed: false,
      resolution: null,
    });
    setUndoRemoveId(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, [patchEdit]);

  const acceptAllBoxPrices = useCallback(() => {
    for (const item of unresolvedFlagged) {
      if (item.flag_reason !== 'Price Mismatch') continue;
      acceptBoxPrice(item);
    }
  }, [unresolvedFlagged, acceptBoxPrice]);

  const removeAllOos = useCallback(() => {
    for (const item of unresolvedFlagged) {
      if (deskLineFlagKind(item.flag_reason) === 'oos') {
        removeFlaggedLine(item);
      }
    }
  }, [unresolvedFlagged, removeFlaggedLine]);

  const unresolvedPriceCount = unresolvedFlagged.filter(
    (i) => i.flag_reason === 'Price Mismatch',
  ).length;
  const unresolvedOosCount = unresolvedFlagged.filter(
    (i) => deskLineFlagKind(i.flag_reason) === 'oos',
  ).length;

  const poSkippedFlagCount = allFlaggedItems.length - flaggedItems.length;

  const showReasonDropdown =
    !resolvingFlags ||
    reasonTouched ||
    nonFlaggedItems.some((i) => edits[i.id]?.priceTouched || edits[i.id]?.removed);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!orderDetail || !userId) throw new Error('Order not loaded');
      if (saveBlocked) {
        throw new Error(`Resolve ${unresolvedFlagged.length} flagged line(s) first`);
      }

      const reviewer = userName ?? 'Billing';
      const nowIso = new Date().toISOString();

      for (const item of items) {
        const edit = edits[item.id];
        if (!edit) continue;

        if (edit.removed) {
          if (item.state === 'flagged') {
            const qtyPending = pickQuantityTarget(item);
            const issueCategory = deskLineIssueCategory(item.flag_reason);
            await ensurePendingItem({
              orderId: orderDetail.id,
              orderNumber: orderDetail.order_number,
              customerId: orderDetail.customer_id,
              customerName: orderDetail.customer_name,
              itemId: item.item_id,
              itemName: item.item_name,
              qtyPending,
              createdBy: reviewer,
              note: item.flag_reason
                ? `Billing desk confirmed — ${item.flag_reason}`
                : 'Billing desk confirmed removal',
              issueCategory,
            });
          }
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
        if (orderDetail.workflow_status === 'picking') {
          await supabase
            .from('orders')
            .update({ reviewer_name: reviewer })
            .eq('id', orderDetail.id);
        } else if (orderDetail.workflow_status === 'flagged') {
          await supabase
            .from('orders')
            .update({
              reviewer_name: reviewer,
              workflow_status: 'completed',
              priority: 'normal',
              approved_at: orderDetail.approved_at ?? nowIso,
              completed_at: nowIso,
              fulfillment_path: 'direct_bill',
            })
            .eq('id', orderDetail.id);
        }
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
      queryClient.invalidateQueries({ queryKey: ['desk-picker-flags'] });
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      const resolvedCount = resolvedFlagged.length;
      toast.success(
        resolvingFlags && resolvedCount > 0
          ? `${resolvedCount} line${resolvedCount === 1 ? '' : 's'} resolved · order updated`
          : flaggedMode
            ? 'Flag resolved ✓'
            : 'Bill saved ✓',
      );
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

  const headerTitle = resolvingFlags
    ? flagSummary.total === 1
      ? '1 item needs review'
      : `${flagSummary.total} items need review`
    : order.order_number;

  const headerSubtitle = resolvingFlags
    ? formatDeskFlagSummarySubtitle(flagSummary) || 'Resolve each flagged line'
    : 'Edit MRP · Save & Bill · Notify picker';

  const renderFlaggedGroup = (groupItems: OrderItem[], opts?: { indent?: boolean; splitHint?: string }) =>
    groupItems.map((item) => {
      const edit = edits[item.id];
      if (!edit) return null;
      return (
        <DeskFlaggedLineRow
          key={item.id}
          item={item}
          edit={edit}
          indent={opts?.indent}
          splitHint={opts?.splitHint}
          onAcceptPrice={() => acceptBoxPrice(item)}
          onKeepQuoted={() => keepQuoted(item)}
          onRemove={() => removeFlaggedLine(item)}
          onUndoRemove={() => undoRemove(item.id)}
          onPriceChange={(price) => updatePrice(item.id, price, item)}
          showUndoRemove={undoRemoveId === item.id}
        />
      );
    });

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
          flaggedMode ? 'bg-[var(--bg-warning-subtle)]' : 'bg-[var(--bg-tertiary)]'
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
            {headerTitle}
          </h2>
          <p
            className={`text-[11px] mt-0.5 ${
              flaggedMode ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-quaternary)]'
            }`}
          >
            {headerSubtitle}
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
            <p className="text-[10px] text-[var(--content-quaternary)]">
              {visibleItems.length} items
              {poSkippedFlagCount > 0 && flaggedItems.length === 0
                ? ` · ${poSkippedFlagCount} on PO`
                : ''}
            </p>
          </div>
        </div>

        {poSkippedFlagCount > 0 && flaggedItems.length === 0 && (
          <p className="text-[10px] text-[var(--content-quaternary)] rounded-lg border border-[var(--border-faint)] bg-[var(--bg-tertiary)] px-3 py-2">
            {poSkippedFlagCount} flagged line{poSkippedFlagCount === 1 ? '' : 's'} already on PO — not
            shown on this bill
          </p>
        )}

        {resolvingFlags && (
          <>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--content-quaternary)]">
                    Flagged lines
                  </p>
                  <p className="text-[9px] text-[var(--content-quaternary)] mt-0.5">
                    Remove or accept inline · adds to pending queue
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {unresolvedPriceCount >= 2 && (
                    <button
                      type="button"
                      onClick={acceptAllBoxPrices}
                      className="h-6 px-2 rounded-md text-[9px] font-semibold bg-[var(--bg-positive)] text-white hover:opacity-95"
                    >
                      Accept all ({unresolvedPriceCount})
                    </button>
                  )}
                  {unresolvedOosCount >= 2 && (
                    <button
                      type="button"
                      onClick={removeAllOos}
                      className="h-6 px-2 rounded-md text-[9px] font-medium border border-[var(--border-negative)] text-[var(--content-negative)] hover:bg-[var(--bg-negative-subtle)]"
                    >
                      Remove all ({unresolvedOosCount})
                    </button>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                <DeskFlaggedSectionHeader />
                {poSkippedFlagCount > 0 && (
                  <p className="px-3 py-2 text-[10px] text-[var(--content-quaternary)] border-b border-[var(--border-faint)] bg-[var(--bg-tertiary)]">
                    {poSkippedFlagCount} line{poSkippedFlagCount === 1 ? '' : 's'} already on PO — hidden from this list
                  </p>
                )}
                {unresolvedFlagged.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] text-[var(--content-positive)] border-t border-[var(--border-faint)]">
                    All flagged lines resolved
                  </p>
                ) : (
                  flaggedItemGroups.map((group) => {
                    const batchCount = orderItemSplitBatchCount(group.siblings);
                    const splitHint =
                      batchCount > 1 ? `${batchCount} MRP batches from pick` : undefined;
                    const unresolvedInGroup = [group.root, ...group.siblings].filter((i) =>
                      isFlaggedUnresolved(i, edits[i.id]),
                    );
                    if (unresolvedInGroup.length === 0) return null;
                    return (
                      <div key={group.key}>
                        {isFlaggedUnresolved(group.root, edits[group.root.id])
                          ? renderFlaggedGroup([group.root], { splitHint })[0]
                          : null}
                        {group.siblings
                          .filter((s) => isFlaggedUnresolved(s, edits[s.id]))
                          .flatMap((sibling) =>
                            renderFlaggedGroup([sibling], { indent: true }) ?? [],
                          )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {resolvedFlagged.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setResolvedSectionOpen((v) => !v)}
                  className="text-[10px] font-semibold uppercase tracking-wide text-[var(--content-quaternary)] mb-1.5 hover:text-[var(--content-secondary)]"
                >
                  Resolved ({resolvedFlagged.length}) {resolvedSectionOpen ? '▾' : '▸'}
                </button>
                {resolvedSectionOpen && (
                  <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden opacity-90">
                    <DeskFlaggedSectionHeader />
                    {flaggedItemGroups.map((group) => {
                      const batchCount = orderItemSplitBatchCount(group.siblings);
                      const splitHint =
                        batchCount > 1 ? `${batchCount} MRP batches from pick` : undefined;
                      const resolvedInGroup = [group.root, ...group.siblings].filter((i) => {
                        const edit = edits[i.id];
                        return edit?.resolution != null;
                      });
                      if (resolvedInGroup.length === 0) return null;
                      return (
                        <div key={`resolved-${group.key}`}>
                          {edits[group.root.id]?.resolution != null
                            ? renderFlaggedGroup([group.root], { splitHint })[0]
                            : null}
                          {group.siblings
                            .filter((s) => edits[s.id]?.resolution != null)
                            .flatMap((sibling) =>
                              renderFlaggedGroup([sibling], { indent: true }) ?? [],
                            )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {nonFlaggedItems.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--content-quaternary)] mb-1.5">
              {resolvingFlags ? 'Other lines' : 'Line items — edit MRP or remove'}
            </p>
            <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
              <div className="grid grid-cols-[1fr_50px_78px_38px] gap-0 bg-[var(--bg-tertiary)] px-2.5 py-1.5 text-[9px] font-semibold uppercase text-[var(--content-quaternary)]">
                <span>Item</span>
                <span>Qty</span>
                <span>MRP</span>
                <span />
              </div>
              {normalItemGroups.map((group) => {
                const batchCount = orderItemSplitBatchCount(group.siblings);
                const splitHint =
                  batchCount > 1 ? `${batchCount} MRP batches from pick` : undefined;
                return (
                  <div key={group.key}>
                    <DeskNormalLineRow
                      item={group.root}
                      edit={edits[group.root.id]!}
                      splitHint={splitHint}
                      pendingRemoveId={pendingRemoveId}
                      onPriceChange={(price) => updatePrice(group.root.id, price, group.root)}
                      onRequestRemove={() => setPendingRemoveId(group.root.id)}
                      onConfirmRemove={() => {
                        patchEdit(group.root.id, { removed: true });
                        setPendingRemoveId(null);
                      }}
                    />
                    {group.siblings.map((sibling) => (
                      <DeskNormalLineRow
                        key={sibling.id}
                        item={sibling}
                        edit={edits[sibling.id]!}
                        indent
                        pendingRemoveId={pendingRemoveId}
                        onPriceChange={(price) => updatePrice(sibling.id, price, sibling)}
                        onRequestRemove={() => setPendingRemoveId(sibling.id)}
                        onConfirmRemove={() => {
                          patchEdit(sibling.id, { removed: true });
                          setPendingRemoveId(null);
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {showReasonDropdown && (
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
              onChange={(e) => {
                setReason(e.target.value as ChangeReason);
                setReasonTouched(true);
              }}
              className="mt-1 w-full h-9 px-2 text-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]"
            >
              {CHANGE_REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <footer className="shrink-0 px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-tertiary)] space-y-1.5">
        {resolvingFlags && step === 'idle' && (
          <p className="text-[10px] text-[var(--content-quaternary)] text-center">
            {allFlagsResolved
              ? 'All flagged lines resolved — save to continue'
              : `${resolvedFlagged.length} of ${flaggedItems.length} flagged lines resolved`}
          </p>
        )}
        <div className="flex items-center gap-2.5">
          <StepCircle state={step === 'idle' ? 'active' : 'done'} number={1} />
          <button
            type="button"
            disabled={saveMutation.isPending || step !== 'idle' || saveBlocked}
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
                {flaggedMode ? 'Flag resolved ✓' : 'Bill saved ✓'}
              </>
            ) : (
              <>
                <Receipt size={16} weight="bold" />
                {saveBlocked
                  ? `Resolve ${unresolvedFlagged.length} flagged line${unresolvedFlagged.length === 1 ? '' : 's'} first`
                  : flaggedMode
                    ? 'Resolve & save'
                    : 'Save & Bill'}
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
