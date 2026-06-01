import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePendingItems } from './usePendingItems';
import { useWorkClaim } from './useWorkClaim';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { supabase } from '../lib/supabase/client';
import { completeBillingWithClaim } from '../lib/billing/completeBilling';
import {
  countEffectivePickLinesAfterBilling,
  resolveFulfillmentPathAfterBilling,
} from '../lib/billing/billLineOutcome';
import {
  formatInternalNotificationError,
  persistAndNotifySalesOrderUpdate,
  type NotifySalesOrderUpdateParams,
} from '../lib/billing/notifySalesOrderUpdate';
import { ensurePendingItem } from '../lib/billing/ensurePendingItem';
import {
  deskLineFlagKind,
  deskLineIssueCategory,
} from '../lib/billing/deskLineFlagKind';
import {
  indexPendingItemsByItemId,
  isDeskFlagLineAlreadyOnPo,
} from '../lib/billing/deskPoCoverage';
import { shouldNotifyPickers } from '../lib/billing/fulfillmentPath';
import { canBroadcastReadyToPick } from '../lib/billing/pickerNotifyPolicy';
import { pickQuantityTarget } from '../lib/cartSupply';
import { sendPickerReadyNotification } from '../lib/pickerPush';
import { sortBillLines } from '../lib/billing/sortBillLines';
import { resolvedLabelPriceForBilling } from '../lib/billing/labelMrpFlag';
import { promoteBillingVerifiedLabelMrp } from '../lib/picking/recordPickerLabelMrp';
import { BILLING_ACCEPT_ALL_LABEL } from '../lib/billing/mrpWorkflowCopy';
import { BILLING_VERIFIED_MRP_QUERY_KEY } from '../lib/billing/billingVerifiedMrp';
import { STOCK_MRP_HISTORY_QUERY_KEY } from '../lib/stockMrpwise';
import {
  billableQtyForTotal,
  deriveBillLineFulfillment,
} from '../lib/billing/billLineFulfillment';
import { orderItemConfirmedMrp } from '../lib/billing/orderItemSplitGroups';
import type { FulfillmentPath, OrderItem, OrderWithItems, PendingItem } from '../types';
import {
  CHANGE_REASON_OPTIONS,
  type ChangeReason,
  type OverlayLineEdit,
  type OverlayLineResolution,
  type OverlayStep,
} from '../pages/billing/BillingDesk/types';

function buildDeskNotifyLines(
  visibleItems: OrderItem[],
  pendingByItemId: Map<number, PendingItem[]>,
): NotifySalesOrderUpdateParams['lines'] {
  return visibleItems.map((item) => {
    const pendingQty = (item.item_id != null ? pendingByItemId.get(item.item_id) : undefined) ?? [];
    const pendingTotal = pendingQty
      .filter((p) => p.status === 'pending')
      .reduce((sum, p) => sum + p.qty_pending, 0);
    const authoritativePending = Math.min(
      item.qty_requested,
      Math.max(pendingTotal, item.qty_po ?? 0),
    );
    const billed = Math.max(
      0,
      Math.min(
        item.qty_approved ?? item.qty_requested,
        item.qty_requested - authoritativePending,
      ),
    );
    return {
      itemId: item.item_id,
      name: item.item_name,
      qtyRequested: item.qty_requested,
      qtyBilled: billed,
      qtyPending: authoritativePending,
    };
  });
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

export interface UseBillSheetEditsOptions {
  orderDetail: OrderWithItems;
  flaggedMode?: boolean;
  orderIdForClaim?: number | null;
  fulfillmentPath?: FulfillmentPath;
  onSaved?: () => void;
  onNotified?: () => void;
}

export function useBillSheetEdits({
  orderDetail,
  flaggedMode = false,
  orderIdForClaim,
  fulfillmentPath = 'warehouse_pick',
  onSaved,
  onNotified,
}: UseBillSheetEditsOptions) {
  const { userId, userName } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const claimOrderId =
    orderIdForClaim ??
    (orderDetail.workflow_status === 'submitted' ? orderDetail.id : null);

  const { claimId, isClaimedByMe, claim, error: claimError } = useWorkClaim(
    claimOrderId,
    'billing',
  );

  const items = orderDetail.items;
  const sortedLines = useMemo(() => sortBillLines(items), [items]);

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
  const [step, setStep] = useState<OverlayStep>('idle');
  const [undoRemoveId, setUndoRemoveId] = useState<number | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetKey = `${orderDetail.id}:${items.map((item) => item.id).join(',')}`;
  const [boundResetKey, setBoundResetKey] = useState(resetKey);
  if (resetKey !== boundResetKey) {
    setBoundResetKey(resetKey);
    setEdits(initEdits(items));
    setReason('no_changes');
    setReasonTouched(false);
    setPendingRemoveId(null);
    setStep('idle');
    setUndoRemoveId(null);
  }

  const claimAutoAttemptedRef = useRef<number | null>(null);
  useEffect(() => {
    if (orderDetail.workflow_status !== 'submitted' || isClaimedByMe) return;
    if (claimAutoAttemptedRef.current === orderDetail.id) return;
    claimAutoAttemptedRef.current = orderDetail.id;
    void claim();
  }, [orderDetail.id, orderDetail.workflow_status, isClaimedByMe, claim]);

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
      sortBillLines(
        allFlaggedItems.filter(
          (item) =>
            !isDeskFlagLineAlreadyOnPo(item, pendingByItemId.get(item.item_id) ?? []),
        ),
      ),
    [allFlaggedItems, pendingByItemId],
  );

  const visibleItems = useMemo(
    () => sortedLines.filter((i) => !edits[i.id]?.removed),
    [sortedLines, edits],
  );

  const total = useMemo(
    () =>
      visibleItems.reduce((acc, item) => {
        const edit = edits[item.id];
        const price = edit?.priceQuoted ?? item.price_quoted ?? item.price_system ?? 0;
        const pending =
          item.item_id != null ? pendingByItemId.get(item.item_id) ?? [] : [];
        const fulfillment = deriveBillLineFulfillment(item, pending);
        const billQty = billableQtyForTotal(item, fulfillment);
        return acc + price * billQty;
      }, 0),
    [visibleItems, edits, pendingByItemId],
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

  const applyReasonFromResolution = useCallback(
    (resolution: OverlayLineResolution) => {
      if (reasonTouched) return;
      if (resolution === 'removed') setReason('out_of_stock');
      else if (resolution === 'accept_price') setReason('old_stock_rate');
      else if (resolution === 'keep_quoted' || resolution === 'manual_override') {
        setReason('data_correction');
      }
    },
    [reasonTouched],
  );

  const patchEdit = useCallback((itemId: number, patch: Partial<OverlayLineEdit>) => {
    setEdits((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId]!, ...patch },
    }));
  }, []);

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
      const labelMrp = orderItemConfirmedMrp(item);
      const accepted = resolvedLabelPriceForBilling(item, labelMrp);
      if (accepted == null) return;
      patchEdit(item.id, {
        priceQuoted: accepted,
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

  const undoRemove = useCallback(
    (itemId: number) => {
      patchEdit(itemId, {
        removed: false,
        resolution: null,
      });
      setUndoRemoveId(null);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    },
    [patchEdit],
  );

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
    sortedLines.some(
      (i) =>
        i.state !== 'flagged' &&
        (edits[i.id]?.priceTouched || edits[i.id]?.removed),
    );

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

        if (edit.resolution === 'accept_price' && item.flag_reason === 'Price Mismatch') {
          await promoteBillingVerifiedLabelMrp(item.id, edit.priceQuoted);
        }
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

      const shouldNotifySales =
        resolvingFlags ||
        orderDetail.workflow_status === 'flagged' ||
        orderDetail.workflow_status === 'completed';

      if (shouldNotifySales && visibleItems.length > 0) {
        try {
          await persistAndNotifySalesOrderUpdate({
            orderId: orderDetail.id,
            orderNumber: orderDetail.order_number,
            customerName: orderDetail.customer_name,
            salespersonName: orderDetail.salesperson_name,
            createdBy: reviewer,
            lines: buildDeskNotifyLines(visibleItems, pendingByItemId),
            notifySales: true,
          });
        } catch (e) {
          console.error('order_update_for_sales', e);
          toast.error(
            `Sales notification failed: ${formatInternalNotificationError(e)}`,
          );
        }
      }

      if (orderDetail.workflow_status === 'submitted') {
        if (!claimId && !isClaimedByMe) {
          const claimResult = await claim();
          if (!claimResult.success || !claimResult.claim_id) {
            throw new Error('Could not claim order for billing');
          }
        }

        const deskFlags: Record<number, never> = {};
        const resolvedPath = resolveFulfillmentPathAfterBilling(
          fulfillmentPath,
          orderDetail.stock_location_code,
          countEffectivePickLinesAfterBilling(visibleItems, deskFlags),
        );

        await completeBillingWithClaim({
          orderId: orderDetail.id,
          claimId: claimId,
          userId,
          claim,
          isResolvingFlags: false,
          fulfillmentPath: resolvedPath,
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
        } else if (orderDetail.workflow_status === 'completed') {
          await supabase
            .from('orders')
            .update({
              reviewer_name: reviewer,
              approved_at: orderDetail.approved_at ?? nowIso,
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
      queryClient.invalidateQueries({ queryKey: ['order', orderDetail.id] });
      queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      queryClient.invalidateQueries({ queryKey: [STOCK_MRP_HISTORY_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [BILLING_VERIFIED_MRP_QUERY_KEY] });
      const resolvedCount = resolvedFlagged.length;
      toast.success(
        resolvingFlags && resolvedCount > 0
          ? `${resolvedCount} line${resolvedCount === 1 ? '' : 's'} resolved · order updated`
          : flaggedMode
            ? 'Flag resolved ✓'
            : 'Bill saved ✓',
      );
      onSaved?.();
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
      onNotified?.();
    },
    onError: () => {
      toast.error('Failed to notify picker');
    },
  });

  return {
    claimError,
    sortedLines,
    edits,
    reason,
    setReason,
    setReasonTouched,
    pendingRemoveId,
    setPendingRemoveId,
    step,
    undoRemoveId,
    flaggedItems,
    visibleItems,
    total,
    unresolvedFlagged,
    resolvedFlagged,
    resolvingFlags,
    allFlagsResolved,
    saveBlocked,
    notifyPickerAllowed,
    poSkippedFlagCount,
    showReasonDropdown,
    unresolvedPriceCount,
    unresolvedOosCount,
    acceptAllBoxPrices,
    removeAllOos,
    updatePrice,
    acceptBoxPrice,
    keepQuoted,
    removeFlaggedLine,
    undoRemove,
    patchEdit,
    saveMutation,
    notifyMutation,
    acceptAllLabel: BILLING_ACCEPT_ALL_LABEL,
    pendingByItemId,
  };
}

export type BillSheetEdits = ReturnType<typeof useBillSheetEdits>;
