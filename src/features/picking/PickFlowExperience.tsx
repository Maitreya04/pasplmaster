import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { FlagReasonSheet, type FlagSubmitPayload } from '../../components/picking/FlagReasonSheet';
import { PickLineResolvedDock } from '../../components/picking/PickLineResolvedDock';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { useWorkClaim } from '../../hooks/useWorkClaim';
import { pickQuantityTarget, pickableOrderItems } from '../../lib/cartSupply';
import type { NextPickLinePreview } from '../../lib/picking/deckOrder';
import { defaultPickItemTransitionAdapter } from '../../lib/picking/itemTransitionAdapter';
import { ensurePendingItem } from '../../lib/billing/ensurePendingItem';
import { deskLineIssueCategory } from '../../lib/billing/deskLineFlagKind';
import {
  isPickNoLongerActiveError,
  pickNoLongerActiveMessage,
} from '../../lib/picking/pickSessionErrors';
import { revertPickLine } from '../../lib/picking/revertPickLine';
import { sendInternalNotification } from '../../lib/pickerPush';
import { supabase } from '../../lib/supabase/client';
import { appHaptics } from '../../lib/haptics';
import type { ConfirmedPriceGroup, MrpSuggestionSource, OrderItem, OrderWithItems } from '../../types';
import { ItemDetailScreen } from './components/ItemDetailScreen';
import { PickLineListView } from './components/PickLineListView';
import { PickOrderProgressBar } from './components/PickOrderProgressBar';
import type { PickLineChip, PickLineChipStatus } from './components/PickLineChipStrip';
import type { PickLineListEntry } from '../../lib/picking/pickLineListDisplay';
import { orderItemUnitPrice } from '../../lib/picking/pickLineListDisplay';
import { PickEntryModal, type LedgerEditField, type PickModalView } from './components/PickEntryModal';
import { SyncStatusPill } from './components/SyncStatusPill';
import { UndoToast } from './components/UndoToast';
import { useCommitPriceGroup } from './hooks/useCommitPriceGroup';
import { createLineDraft, usePickEntryDraft } from './hooks/usePickEntryDraft';
import { applyShortPickScanResult } from './lib/buildPriceGroupScanResult';
import {
  buildLineDraftFromOrderItem,
  deriveCompletedLinesFromOrder,
  sumLineDraftLogged,
} from './lib/hydrateLineDraft';
import {
  readPickFlowSession,
  writePickFlowSession,
} from './lib/pickFlowSession';
import { findNextPendingLineIndex } from './lib/pickLineNavigation';
import { pickQtyOrderCopy, pickQtyVariance } from './lib/pickQtyDisplay';
import { useMrpSuggestion } from './hooks/useMrpSuggestion';
import { useUndoableAction } from './hooks/useUndoableAction';

export interface PickFlowExperienceProps {
  orderId?: number;
  /** Lab-only in-memory order — skips Supabase fetch when set. */
  demoOrder?: import('../../types').OrderWithItems;
  mode?: 'lab' | 'production';
  onBack: () => void;
  /** Production: navigate to box-count finalisation. Falls back to onBack. */
  onFinish?: () => void;
}

type LineOutcome =
  | { kind: 'picked'; itemId: number; pickedQty: number; targetQty: number }
  | { kind: 'partial'; itemId: number; pickedQty: number; targetQty: number }
  | { kind: 'flagged'; itemId: number; reason: string; pickedQty: number; targetQty: number };

type CompletedLineStatus = 'picked' | 'partial' | 'flagged';

type PickViewMode = 'card' | 'list';
type FlagSheetMode = 'issue' | 'short';

type UndoPayload = {
  group: ConfirmedPriceGroup;
  rootOrderItemId: number;
};

function partCode(item: OrderItem): string {
  return (
    item.catalog_alias1 ??
    item.catalog_alias ??
    item.item_alias ??
    String(item.item_id)
  );
}

function salesUom(item: OrderItem): string {
  return item.sales_unit ?? 'pcs';
}

export function PickFlowExperience({
  orderId,
  demoOrder,
  mode = 'lab',
  onBack,
  onFinish,
}: PickFlowExperienceProps): React.JSX.Element {
  const isLab = mode === 'lab';
  const useDemo = isLab && demoOrder != null;
  const { userId, userName } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const orderQuery = useOrderDetail(useDemo ? null : (orderId ?? null));
  const order: OrderWithItems | null | undefined = useDemo ? demoOrder : orderQuery.data;
  const isLoading = useDemo ? false : orderQuery.isLoading;
  const error = useDemo ? null : orderQuery.error;
  const { claimId } = useWorkClaim(useDemo ? null : (orderId ?? null), 'picking');

  const pickItems = useMemo(
    () => (order?.items ? pickableOrderItems(order.items) : []),
    [order?.items],
  );

  const [lineIndex, setLineIndex] = useState(() => {
    if (useDemo || orderId == null) return 0;
    const session = readPickFlowSession(orderId, isLab ? 'lab' : 'production');
    return session?.lineIndex ?? 0;
  });
  const [viewMode, setViewMode] = useState<PickViewMode>('card');
  const [completedLines, setCompletedLines] = useState<Record<number, CompletedLineStatus>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [modalView, setModalView] = useState<PickModalView>('mrp');
  const [priceFixOpen, setPriceFixOpen] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagSheetMode, setFlagSheetMode] = useState<FlagSheetMode>('issue');
  const [lineOutcome, setLineOutcome] = useState<LineOutcome | null>(null);
  const [flashGroupId, setFlashGroupId] = useState<string | null>(null);
  const [revertPending, setRevertPending] = useState(false);
  const [ledgerEditField, setLedgerEditField] = useState<LedgerEditField>(null);
  const editSnapshotRef = useRef<ConfirmedPriceGroup | null>(null);
  const closedPickToastShownRef = useRef(false);
  const pickSessionBootstrappedRef = useRef<number | null>(null);
  const sessionSuggestedRef = useRef<{
    mrp: number | null;
    source: MrpSuggestionSource;
    stockMrp: number | null;
    historyCount: number;
  }>({ mrp: null, source: 'empty', stockMrp: null, historyCount: 0 });

  const currentItem = pickItems[lineIndex] ?? null;
  const mrpSuggestion = useMrpSuggestion(currentItem);
  const targetQty = currentItem ? pickQuantityTarget(currentItem) : 0;

  const initialDraft = useMemo(
    () =>
      currentItem
        ? createLineDraft({
            rootOrderItemId: currentItem.id,
            targetQty,
            uom: salesUom(currentItem),
          })
        : createLineDraft({ rootOrderItemId: 0, targetQty: 0, uom: 'pcs' }),
    [currentItem, targetQty],
  );

  const draftState = usePickEntryDraft(initialDraft);
  const { commit, undo, syncStatus, pendingCount } = useCommitPriceGroup();
  const undoAction = useUndoableAction<UndoPayload>();

  useEffect(() => {
    if (isLab || useDemo || !orderId || !order) return;
    if (order.workflow_status !== 'picking') {
      if (!closedPickToastShownRef.current) {
        closedPickToastShownRef.current = true;
        toast.info(
          pickNoLongerActiveMessage(
            order.workflow_status === 'completed' || order.workflow_status === 'flagged'
              ? 'already_finalised'
              : 'not_picking',
          ),
        );
      }
      onBack();
    }
  }, [isLab, onBack, order, orderId, toast, useDemo]);

  useEffect(() => {
    if (useDemo || !order || orderId == null || pickItems.length === 0) return;
    if (pickSessionBootstrappedRef.current === orderId) return;
    pickSessionBootstrappedRef.current = orderId;

    const sessionScope = isLab ? 'lab' : 'production';
    const session = readPickFlowSession(orderId, sessionScope);
    const serverCompleted = deriveCompletedLinesFromOrder(pickItems, order.items);
    setCompletedLines({ ...serverCompleted, ...(session?.completedLines ?? {}) });

    const restoredIndex =
      session?.lineIndex != null &&
      session.lineIndex >= 0 &&
      session.lineIndex < pickItems.length
        ? session.lineIndex
        : 0;
    setLineIndex(restoredIndex);
  }, [isLab, order, orderId, pickItems, useDemo]);

  useEffect(() => {
    if (useDemo || orderId == null) return;
    writePickFlowSession(
      orderId,
      { lineIndex, completedLines },
      isLab ? 'lab' : 'production',
    );
  }, [completedLines, isLab, lineIndex, orderId, useDemo]);

  // Reset draft when the picker navigates to a different line — not when the
  // server refetches and swaps order_item ids after an MRP split on the same line.
  useEffect(() => {
    if (!currentItem || !order) return;
    draftState.reset(buildLineDraftFromOrderItem(currentItem, order.items));
    setLineOutcome(null);
    setModalOpen(false);
    setModalView('mrp');
    setPriceFixOpen(false);
    setLedgerEditField(null);
    editSnapshotRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when line index changes only
  }, [lineIndex]);

  /** Frozen when the line opens — do not use live order_item qty after MRP splits. */
  const lineTargetQty = draftState.draft.targetQty;

  const shortFlagContext = useMemo(() => {
    if (!currentItem) return undefined;
    const logged = draftState.totalLogged;
    const rem = Math.max(0, lineTargetQty - logged);
    return `You've logged ${logged} of ${lineTargetQty} ${salesUom(currentItem)}. What's wrong with the remaining ${rem}?`;
  }, [currentItem, draftState.totalLogged, lineTargetQty]);

  const openPickModal = useCallback(() => {
    editSnapshotRef.current = null;
    setLedgerEditField(null);
    sessionSuggestedRef.current = {
      mrp: null,
      source: 'empty',
      stockMrp: null,
      historyCount: 0,
    };
    draftState.startPick();
    setModalView('mrp');
    setModalOpen(true);
  }, [draftState]);

  const handleSuggestedMrpApplied = useCallback(
    (mrp: number) => {
      sessionSuggestedRef.current = {
        mrp,
        source: mrpSuggestion.suggestionSource,
        stockMrp: mrpSuggestion.stockMrp,
        historyCount: mrpSuggestion.historyCount,
      };
    },
    [mrpSuggestion.historyCount, mrpSuggestion.stockMrp, mrpSuggestion.suggestionSource],
  );

  const cancelLedgerEdit = useCallback(() => {
    if (editSnapshotRef.current) {
      draftState.cancelEdit(editSnapshotRef.current);
      editSnapshotRef.current = null;
    } else {
      draftState.clearInProgress();
    }
    setLedgerEditField(null);
  }, [draftState]);

  const openEditGroupMrp = useCallback(
    (groupId: string) => {
      const group = draftState.draft.confirmedGroups.find((g) => g.id === groupId);
      if (!group) return;
      editSnapshotRef.current = group;
      draftState.beginEdit(groupId);
      setLedgerEditField('mrp');
      setFlashGroupId(groupId);
      setModalView('gap');
      setModalOpen(true);
      setPriceFixOpen(true);
      window.setTimeout(() => setFlashGroupId(null), 700);
    },
    [draftState],
  );

  const openEditGroupQty = useCallback(
    (groupId: string) => {
      const group = draftState.draft.confirmedGroups.find((g) => g.id === groupId);
      if (!group) return;
      editSnapshotRef.current = group;
      draftState.beginEdit(groupId);
      setLedgerEditField('qty');
      setFlashGroupId(groupId);
      setModalView('qty');
      setModalOpen(true);
      setPriceFixOpen(false);
      window.setTimeout(() => setFlashGroupId(null), 700);
    },
    [draftState],
  );

  const handleConfirmGroup = useCallback(async () => {
    if (!currentItem || !order) return;
    if (!useDemo && !userId) return;
    const ip = draftState.draft.inProgress;
    if (!ip || ip.mrp == null || ip.qty == null || ip.qty <= 0) return;

    const isFirstSegment = draftState.draft.confirmedGroups.length === 0;
    const totalAfter = draftState.totalLogged + ip.qty;
    const isOverTarget = totalAfter > lineTargetQty;

    if (isOverTarget && !draftState.draft.noteText.trim()) {
      appHaptics.warning();
      toast.error('Add a reason before picking above the order qty.');
      return;
    }

    const roundedMrp = Math.round(ip.mrp);
    const sessionSuggested = sessionSuggestedRef.current;
    const acceptedSuggestion =
      sessionSuggested.mrp != null && roundedMrp === sessionSuggested.mrp;

    let orderItemId = currentItem.id;

    if (!isLab && !useDemo && order && orderId != null && userId) {
      const result = await commit({
        orderId: order.id,
        claimId,
        userId,
        orderItem: currentItem,
        rootOrderItemId: draftState.draft.rootOrderItemId,
        segmentQty: ip.qty,
        confirmedMrp: ip.mrp,
        isFirstSegment,
        totalLogged: totalAfter,
        targetQty: lineTargetQty,
        pickerName: userName,
        pickerNote: isOverTarget ? draftState.draft.noteText.trim() : null,
        isOverTarget,
        mrpContext: {
          suggestedMrpAtPick: sessionSuggested.mrp ?? mrpSuggestion.suggestedMrp,
          stockMrpAtPick: mrpSuggestion.stockMrp,
          suggestionSource: mrpSuggestion.suggestionSource,
          historyCount: mrpSuggestion.historyCount,
          acceptedSuggestion,
        },
      });

      if (!result.success) {
        appHaptics.warning();
        const errorCode = result.error ?? 'commit_failed';
        if (isPickNoLongerActiveError(errorCode)) {
          toast.info(pickNoLongerActiveMessage(errorCode));
          if (orderId != null) {
            void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
          }
          onBack();
          return;
        }
        toast.error(
          errorCode === 'qty_exceeds_line'
            ? 'Could not save — picked qty is above the order line. Ask admin to apply the latest database update.'
            : 'Could not save pick — try again',
        );
        return;
      }
      orderItemId = result.order_item_id ?? currentItem.id;
      // Avoid refetching mid-segment — it rebuilds pickItems and flickers the UI.
      // Server sync happens on mark-picked, flag, and undo.
    }

    const groupSnapshot: ConfirmedPriceGroup = {
      id: draftState.draft.editingGroupId ?? crypto.randomUUID(),
      orderItemId,
      mrp: ip.mrp,
      qty: ip.qty,
      isOverTarget,
      pickerNote: isOverTarget ? draftState.draft.noteText.trim() : null,
    };

    draftState.commitGroup(orderItemId);
    editSnapshotRef.current = null;
    setLedgerEditField(null);

    const remainingAfter = Math.max(0, lineTargetQty - totalAfter);
    setModalView('gap');

    await undoAction.trigger({
      label: `${ip.qty} ${draftState.draft.uom} @ ₹${Math.round(ip.mrp)} logged`,
      detail: {
        qty: ip.qty,
        uom: draftState.draft.uom,
        mrp: Math.round(ip.mrp),
      },
      payload: { group: groupSnapshot, rootOrderItemId: draftState.draft.rootOrderItemId },
      onCommit: async () => {},
      onUndo: async (payload) => {
        draftState.popLastGroup();
        if (!isLab && !useDemo && order && userId && orderId != null) {
          await undo({
            orderId: order.id,
            claimId,
            userId,
            rootOrderItemId: payload.rootOrderItemId,
            segmentOrderItemId: payload.group.orderItemId,
            restoreQty:
              payload.group.qty === totalAfter && isFirstSegment ? lineTargetQty : null,
          });
          await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        }
        const remainingAfterUndo = Math.max(0, lineTargetQty - (totalAfter - payload.group.qty));
        if (remainingAfterUndo > 0) {
          setModalView('gap');
          setModalOpen(true);
        } else {
          setModalOpen(false);
        }
      },
    });

    if (remainingAfter === 0) {
      // gap view shows Mark picked CTA
    }
  }, [
    claimId,
    commit,
    currentItem,
    draftState,
    isLab,
    order,
    queryClient,
    lineTargetQty,
    mrpSuggestion.historyCount,
    mrpSuggestion.stockMrp,
    mrpSuggestion.suggestedMrp,
    mrpSuggestion.suggestionSource,
    undo,
    undoAction,
    userId,
    toast,
    userName,
    useDemo,
    orderId,
    onBack,
  ]);

  const finishOrder = onFinish ?? onBack;

  const advanceLine = useCallback(() => {
    setLineOutcome(null);
    setViewMode('card');
    setLineIndex((from) => {
      const next = findNextPendingLineIndex(pickItems, from, completedLines);
      return next ?? from;
    });
  }, [completedLines, pickItems]);

  /** After a line is done: toast + jump to next rack. No full-screen stop for normal picks. */
  const continueAfterLineClose = useCallback(
    (outcome: Exclude<LineOutcome, { kind: 'flagged' }>) => {
      if (!currentItem) return;

      const status: CompletedLineStatus = outcome.kind === 'picked' ? 'picked' : 'partial';
      const nextCompleted = { ...completedLines, [outcome.itemId]: status };
      setCompletedLines(nextCompleted);

      const code = partCode(currentItem);
      const uom = salesUom(currentItem);
      const nextIdx = findNextPendingLineIndex(pickItems, lineIndex, nextCompleted);
      const nextItem = nextIdx != null ? pickItems[nextIdx] : null;
      const { isOver } = pickQtyVariance(outcome.pickedQty, outcome.targetQty);

      if (outcome.kind === 'partial' || isOver) {
        toast.warning(`${code}: ${pickQtyOrderCopy(outcome.pickedQty, outcome.targetQty, uom)}`);
      } else if (nextItem) {
        toast.success(`${outcome.pickedQty} ${uom} ✓ · Next: ${partCode(nextItem)}`);
      } else {
        toast.success('All lines picked — pack & finish', {
          action: { label: 'Finish', onClick: finishOrder },
        });
      }

      if (nextIdx != null) {
        setLineIndex(nextIdx);
      }
      setViewMode('card');
    },
    [completedLines, currentItem, finishOrder, lineIndex, pickItems, toast],
  );

  const handleShortPickSubmit = useCallback(
    async (payload: FlagSubmitPayload) => {
      if (!currentItem) return;
      const pickedQty = draftState.totalLogged;
      const shortQty = Math.max(0, lineTargetQty - pickedQty);
      if (pickedQty <= 0 || shortQty <= 0) return;

      appHaptics.impactMedium();

      if (!isLab && !useDemo && order) {
        try {
          const segmentIds = [
            ...new Set(
              draftState.draft.confirmedGroups
                .map((group) => group.orderItemId)
                .filter((id) => Number.isFinite(id)),
            ),
          ];
          if (segmentIds.length === 0) segmentIds.push(currentItem.id);

          const { data: scanRows, error: scanRowsError } = await supabase
            .from('order_items')
            .select('id, scan_result')
            .in('id', segmentIds);
          if (scanRowsError) {
            toast.error(scanRowsError.message);
            return;
          }

          const updates = (scanRows ?? [])
            .map((row) => {
              const scanResult = applyShortPickScanResult(
                row.scan_result as OrderItem['scan_result'],
                {
                  pickedQty,
                  targetQty: lineTargetQty,
                  reason: payload.reason,
                  note: payload.notes,
                },
              );
              return scanResult ? { id: row.id as number, scanResult } : null;
            })
            .filter(
              (row): row is { id: number; scanResult: NonNullable<OrderItem['scan_result']> } =>
                row != null,
            );

          for (const update of updates) {
            const { error: updateError } = await supabase
              .from('order_items')
              .update({ scan_result: update.scanResult as unknown as Record<string, unknown> })
              .eq('id', update.id);
            if (updateError) {
              toast.error(updateError.message);
              return;
            }
          }

          await ensurePendingItem({
            orderId: order.id,
            orderNumber: order.order_number,
            customerId: order.customer_id,
            customerName: order.customer_name,
            itemId: currentItem.item_id,
            itemName: currentItem.item_name,
            qtyPending: shortQty,
            source: 'picking',
            createdBy: userName || 'Picker',
            note: `Picker short ${shortQty} of ${lineTargetQty} — ${payload.reason}${
              payload.notes ? `: ${payload.notes}` : ''
            }`,
            issueCategory: deskLineIssueCategory(payload.reason) ?? 'out_of_stock',
          });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Could not save short pick');
          return;
        }
      }

      setFlagOpen(false);
      setFlagSheetMode('issue');
      setModalOpen(false);
      continueAfterLineClose({
        kind: 'partial',
        itemId: currentItem.id,
        pickedQty,
        targetQty: lineTargetQty,
      });
      if (!isLab && !useDemo && orderId != null) {
        void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        void queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      }
    },
    [
      continueAfterLineClose,
      currentItem,
      draftState.draft.confirmedGroups,
      draftState.totalLogged,
      isLab,
      lineTargetQty,
      order,
      orderId,
      queryClient,
      toast,
      useDemo,
      userName,
    ],
  );

  const handleMarkPicked = useCallback(() => {
    if (!currentItem) return;
    appHaptics.impactMedium();
    const logged = draftState.totalLogged;
    if (logged > 0 && logged < lineTargetQty) {
      setFlagSheetMode('short');
      setFlagOpen(true);
      return;
    }
    setModalOpen(false);
    const outcome: LineOutcome =
      logged >= lineTargetQty
        ? { kind: 'picked', itemId: currentItem.id, pickedQty: logged, targetQty: lineTargetQty }
        : { kind: 'partial', itemId: currentItem.id, pickedQty: logged, targetQty: lineTargetQty };

    if (!isLab && !useDemo && orderId != null) {
      void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    }

    continueAfterLineClose(outcome);
  }, [
    continueAfterLineClose,
    currentItem,
    draftState.totalLogged,
    isLab,
    lineTargetQty,
    orderId,
    queryClient,
    useDemo,
  ]);

  const handleFlagSubmit = useCallback(
    async (payload: FlagSubmitPayload) => {
      if (!currentItem) return;
      if (flagSheetMode === 'short') {
        await handleShortPickSubmit(payload);
        return;
      }
      appHaptics.impactMedium();

      if (!isLab && !useDemo && order) {
        try {
          await defaultPickItemTransitionAdapter.applyTransition({
            kind: 'flagged',
            itemId: currentItem.id,
            reason: payload.reason,
            notes: payload.notes,
            boxPrice: null,
            scanResult: currentItem.scan_result ?? null,
          });

          if (payload.reason === 'Out of Stock') {
            const qtyPending = pickQuantityTarget(currentItem);
            if (qtyPending > 0) {
              const { data: existing, error: existingError } = await supabase
                .from('pending_items')
                .select('id')
                .eq('order_id', order.id)
                .eq('item_id', currentItem.item_id)
                .eq('status', 'pending')
                .eq('source', 'picking')
                .limit(1)
                .maybeSingle();
              if (!existingError && !existing) {
                await supabase.from('pending_items').insert({
                  order_id: order.id,
                  order_number: order.order_number,
                  customer_id: order.customer_id,
                  customer_name: order.customer_name,
                  item_id: currentItem.item_id,
                  item_name: currentItem.item_name,
                  qty_pending: qtyPending,
                  source: 'picking',
                  created_by: userName || 'Picker',
                  note: payload.notes || null,
                });
              }
            }
          }

          try {
            await sendInternalNotification({
              eventType: 'item_flagged_by_picker',
              orderId: order.id,
              orderNumber: order.order_number,
              customerName: order.customer_name,
              itemName: currentItem.item_name,
              flagReason: payload.reason,
              pickerName: userName,
              orderItemId: currentItem.id,
              flagNotes: payload.notes,
              flagBoxPrice: null,
            });
          } catch {
            /* notification failure should not block flag */
          }
        } catch {
          return;
        }
      }

      setFlagOpen(false);
      setFlagSheetMode('issue');
      setModalOpen(false);
      setLineOutcome({
        kind: 'flagged',
        itemId: currentItem.id,
        reason: payload.reason,
        pickedQty: draftState.totalLogged,
        targetQty: lineTargetQty,
      });
      setCompletedLines((prev) => ({
        ...prev,
        [currentItem.id]: 'flagged',
      }));
      if (!isLab && !useDemo && orderId != null) {
        void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      }
    },
    [
      currentItem,
      draftState.totalLogged,
      flagSheetMode,
      handleShortPickSubmit,
      isLab,
      order,
      orderId,
      queryClient,
      lineTargetQty,
      useDemo,
      userName,
    ],
  );

  const handleUndoFlag = useCallback(async () => {
    if (!lineOutcome || lineOutcome.kind !== 'flagged' || !currentItem) return;
    if (!useDemo && !isLab && (!order || !userId)) return;

    setRevertPending(true);
    try {
      if (!isLab && !useDemo && order && userId) {
        await revertPickLine({
          orderId: order.id,
          claimId,
          userId,
          orderItemId: currentItem.id,
          mode: 'full',
        });
        if (orderId != null) {
          await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        }
      }
      draftState.reset(
        createLineDraft({
          rootOrderItemId: currentItem.id,
          targetQty: lineTargetQty,
          uom: salesUom(currentItem),
        }),
      );
      setCompletedLines((prev) => {
        const next = { ...prev };
        delete next[currentItem.id];
        return next;
      });
      setLineOutcome(null);
    } finally {
      setRevertPending(false);
    }
  }, [
    claimId,
    currentItem,
    draftState,
    isLab,
    lineOutcome,
    order,
    orderId,
    queryClient,
    lineTargetQty,
    useDemo,
    userId,
  ]);

  const goToLine = useCallback((index: number) => {
    setLineOutcome(null);
    setLineIndex(Math.max(0, Math.min(index, pickItems.length - 1)));
    setViewMode('card');
  }, [pickItems.length]);

  const listRows = useMemo((): PickLineListEntry[] => {
    if (!order) return [];
    return pickItems.map((item, index) => {
      const itemDraft = buildLineDraftFromOrderItem(item, order.items);
      const itemTargetQty = itemDraft.targetQty;
      const itemLogged = sumLineDraftLogged(itemDraft);
      const completed = completedLines[item.id];
      const isCurrent = index === lineIndex;
      const loggedOnCurrent = isCurrent ? draftState.totalLogged : itemLogged;

      let status: PickLineListEntry['status'] = 'pending';
      if (completed === 'picked') status = 'picked';
      else if (completed === 'flagged') status = 'flagged';
      else if (completed === 'partial') status = 'partial';
      else if (isCurrent && loggedOnCurrent > 0) status = 'partial';
      else if (isCurrent) status = 'now';

      return {
        itemId: item.id,
        rackNo: item.rack_no,
        partCode: partCode(item),
        itemName: item.item_name,
        targetQty: itemTargetQty,
        pickedQty: completed === 'partial' || loggedOnCurrent > 0 ? loggedOnCurrent : undefined,
        uom: salesUom(item),
        unitPrice: orderItemUnitPrice(item.price_quoted, item.price_system),
        status,
      };
    });
  }, [completedLines, draftState.totalLogged, lineIndex, order, pickItems]);

  const doneCount = useMemo(
    () => listRows.filter((row) => row.status === 'picked' || row.status === 'flagged').length,
    [listRows],
  );

  const lineChips = useMemo((): PickLineChip[] => {
    return listRows.map((row, index) => {
      let status: PickLineChipStatus;
      if (row.status === 'now') status = 'now';
      else if (row.status === 'skipped') status = 'pending';
      else status = row.status;
      return { index, status };
    });
  }, [listRows]);

  const markedStatus = currentItem ? completedLines[currentItem.id] : undefined;
  const revisitComplete =
    (markedStatus === 'picked' || markedStatus === 'partial') &&
    draftState.totalLogged === 0;

  if (isLoading) {
    return (
      <div className="role-picking flex min-h-dvh items-center justify-center bg-[var(--bg-primary)]">
        <p className="font-ds-body-size text-[var(--content-secondary)]">Loading order…</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="role-picking min-h-dvh bg-[var(--bg-primary)] p-4">
        <p className="text-[var(--content-negative)]">Failed to load order</p>
        <button type="button" onClick={onBack} className="mt-4 font-ds-body-size font-semibold text-[var(--content-accent)]">
          Back
        </button>
      </div>
    );
  }

  if (pickItems.length === 0) {
    return (
      <div className="role-picking min-h-dvh bg-[var(--bg-primary)] p-4">
        <p className="font-ds-body-size text-[var(--content-secondary)]">No pickable lines on this order.</p>
        <button type="button" onClick={onBack} className="mt-4 font-ds-body-size font-semibold text-[var(--content-accent)]">
          Back
        </button>
      </div>
    );
  }

  if (!currentItem) {
    return (
      <div className="role-picking min-h-dvh bg-[var(--bg-primary)] p-4">
        <p className="font-ds-body-size text-[var(--content-secondary)]">All lines handled.</p>
        <button type="button" onClick={onBack} className="mt-4 font-ds-body-size font-semibold text-[var(--content-accent)]">
          Back
        </button>
      </div>
    );
  }

  const remaining = Math.max(0, lineTargetQty - draftState.totalLogged);

  const outcomeHeadline =
    lineOutcome?.kind === 'flagged' ? `Flagged · ${lineOutcome.reason}` : '';

  const outcomeDetail =
    lineOutcome?.kind === 'flagged'
      ? `${lineOutcome.pickedQty} of ${lineOutcome.targetQty} logged`
      : undefined;

  const nextPendingIdx =
    lineOutcome?.kind === 'flagged'
      ? findNextPendingLineIndex(pickItems, lineIndex, completedLines)
      : null;
  const nextPendingItem = nextPendingIdx != null ? pickItems[nextPendingIdx] : null;
  const nextPreview: NextPickLinePreview | null = nextPendingItem
    ? {
        code: partCode(nextPendingItem),
        rackNo: nextPendingItem.rack_no,
        itemName: nextPendingItem.item_name,
        deckIndex: nextPendingIdx ?? 0,
      }
    : null;

  return (
    <div className="role-picking flex h-dvh flex-col overflow-hidden bg-[var(--bg-primary)]">
      <header className="sticky top-0 z-30 shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="pick-flow-header-row flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={onBack}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl pick-pressable"
            aria-label="Back"
          >
            <CaretLeft size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-ds-caption-size font-semibold text-[var(--content-primary)]">
              {order.customer_name ?? order.order_number}
              {useDemo ? ' · demo' : ''}
            </p>
            <p className="truncate font-ds-micro text-[var(--content-tertiary)]">
              {order.order_number}
            </p>
          </div>
          <SyncStatusPill status={useDemo ? 'saved' : syncStatus} pendingCount={pendingCount} />
        </div>

        {!lineOutcome || lineOutcome.kind !== 'flagged' ? (
          <div className="pick-flow-toolbar border-t border-[var(--border-faint)] px-4 py-2">
            <PickOrderProgressBar
              doneCount={doneCount}
              totalCount={pickItems.length}
              onPress={() => setViewMode('list')}
            />
            <div className="mt-2 flex justify-center">
              <div className="inline-flex rounded-full border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('card')}
                  className={`rounded-full px-4 py-1.5 text-[11px] font-bold pick-pressable ${
                    viewMode === 'card'
                      ? 'bg-[var(--role-primary)] text-white'
                      : 'text-[var(--content-secondary)]'
                  }`}
                >
                  Card
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`rounded-full px-4 py-1.5 text-[11px] font-bold pick-pressable ${
                    viewMode === 'list'
                      ? 'bg-[var(--role-primary)] text-white'
                      : 'text-[var(--content-secondary)]'
                  }`}
                >
                  List
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <div className="pick-flow-body flex min-h-0 flex-1 flex-col overflow-hidden">
      {lineOutcome?.kind === 'flagged' ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <PickLineResolvedDock
            kind="flagged"
            headline={outcomeHeadline}
            detail={outcomeDetail}
            nextPreview={nextPreview}
            onNext={advanceLine}
            onUndoPick={() => void handleUndoFlag()}
            undoDisabled={revertPending}
          />
        </div>
      ) : viewMode === 'list' ? (
        <PickLineListView
          rows={listRows}
          currentItemId={currentItem.id}
          doneCount={doneCount}
          totalCount={pickItems.length}
          onSelectLine={(itemId) => {
            const idx = pickItems.findIndex((item) => item.id === itemId);
            if (idx >= 0) goToLine(idx);
          }}
        />
      ) : (
        <ItemDetailScreen
          rackNo={currentItem.rack_no}
          partCode={partCode(currentItem)}
          itemName={currentItem.item_name}
          targetQty={lineTargetQty}
          uom={salesUom(currentItem)}
          draft={draftState.draft}
          totalLogged={draftState.totalLogged}
          remaining={remaining}
          isComplete={draftState.isComplete}
          lineIndex={lineIndex}
          totalLines={pickItems.length}
          doneCount={doneCount}
          lineChips={lineChips}
          markedStatus={markedStatus}
          revisitComplete={revisitComplete}
          onPickItem={openPickModal}
          onNextItem={advanceLine}
          onFinishOrder={finishOrder}
          onPrevLine={() => goToLine(lineIndex - 1)}
          onNextLine={() => goToLine(lineIndex + 1)}
          onGoToLine={goToLine}
          onSeeAllLines={() => setViewMode('list')}
          onFlag={() => {
            setFlagSheetMode('issue');
            setFlagOpen(true);
          }}
          onEditPick={openPickModal}
          onEditGroupMrp={openEditGroupMrp}
          onEditGroupQty={openEditGroupQty}
          flashGroupId={flashGroupId}
        />
      )}
      </div>

      <PickEntryModal
        isOpen={modalOpen}
        partCode={partCode(currentItem)}
        rackNo={currentItem.rack_no}
        draftState={draftState}
        modalView={modalView}
        ledgerEditField={ledgerEditField}
        onEditGroupMrp={openEditGroupMrp}
        onEditGroupQty={openEditGroupQty}
        onClose={() => {
          if (ledgerEditField) {
            cancelLedgerEdit();
          } else {
            draftState.clearInProgress();
          }
          setModalOpen(false);
          setPriceFixOpen(false);
          setLedgerEditField(null);
        }}
        onAdvanceToQty={() => setModalView('qty')}
        onSwitchToQty={() => setModalView('qty')}
        onConfirmGroup={() => void handleConfirmGroup()}
        onNextLabel={() => {
          editSnapshotRef.current = null;
          setLedgerEditField(null);
          sessionSuggestedRef.current = {
            mrp: null,
            source: 'empty',
            stockMrp: null,
            historyCount: 0,
          };
          draftState.startPick();
          setModalView('mrp');
        }}
        onShortStock={() => {
          setFlagSheetMode('issue');
          setFlagOpen(true);
        }}
        onMarkPicked={handleMarkPicked}
        onOpenPriceFix={() => setPriceFixOpen(true)}
        onPriceFixConfirm={(mrp) => {
          draftState.fixMrp(mrp);
          setPriceFixOpen(false);
          if (ledgerEditField === 'mrp') {
            void handleConfirmGroup();
          }
        }}
        priceFixOpen={priceFixOpen}
        onPriceFixClose={() => {
          if (ledgerEditField === 'mrp') {
            cancelLedgerEdit();
          }
          setPriceFixOpen(false);
        }}
        flashGroupId={flashGroupId}
        suggestedMrp={mrpSuggestion.suggestedMrp}
        stockMrp={mrpSuggestion.stockMrp}
        alternates={mrpSuggestion.alternates}
        mrpSuggestionLoading={mrpSuggestion.isLoading}
        onSuggestedMrpApplied={handleSuggestedMrpApplied}
      />

      <FlagReasonSheet
        isOpen={flagOpen}
        onClose={() => {
          setFlagOpen(false);
          setFlagSheetMode('issue');
        }}
        onSubmit={handleFlagSubmit}
        contextBanner={shortFlagContext}
        encourageNote
      />

      {undoAction.toast ? (
        <UndoToast
          toast={undoAction.toast}
          onUndo={() => void undoAction.runUndo()}
        />
      ) : null}
    </div>
  );
}
