import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretLeft } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { FlagReasonSheet, type FlagSubmitPayload } from '../../components/picking/FlagReasonSheet';
import { PickLineResolvedDock } from '../../components/picking/PickLineResolvedDock';
import { useAuth } from '../../context/AuthContext';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { useWorkClaim } from '../../hooks/useWorkClaim';
import { pickQuantityTarget, pickableOrderItems } from '../../lib/cartSupply';
import type { NextPickLinePreview } from '../../lib/picking/deckOrder';
import { defaultPickItemTransitionAdapter } from '../../lib/picking/itemTransitionAdapter';
import { revertPickLine } from '../../lib/picking/revertPickLine';
import { sendInternalNotification } from '../../lib/pickerPush';
import { supabase } from '../../lib/supabase/client';
import { appHaptics } from '../../lib/haptics';
import type { ConfirmedPriceGroup, MrpSuggestionSource, OrderItem, OrderWithItems } from '../../types';
import { ItemDetailScreen } from './components/ItemDetailScreen';
import { PickLineListView } from './components/PickLineListView';
import { PickOrderProgressBar } from './components/PickOrderProgressBar';
import type { PickLineChip } from './components/PickLineChipStrip';
import type { PickLineListEntry } from '../../lib/picking/pickLineListDisplay';
import { orderItemUnitPrice } from '../../lib/picking/pickLineListDisplay';
import { PickEntryModal, type LedgerEditField, type PickModalView } from './components/PickEntryModal';
import { SyncStatusPill } from './components/SyncStatusPill';
import { UndoToast } from './components/UndoToast';
import { useCommitPriceGroup } from './hooks/useCommitPriceGroup';
import { createLineDraft, usePickEntryDraft } from './hooks/usePickEntryDraft';
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

  const [lineIndex, setLineIndex] = useState(0);
  const [viewMode, setViewMode] = useState<PickViewMode>('card');
  const [completedLines, setCompletedLines] = useState<Record<number, CompletedLineStatus>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [modalView, setModalView] = useState<PickModalView>('mrp');
  const [priceFixOpen, setPriceFixOpen] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [lineOutcome, setLineOutcome] = useState<LineOutcome | null>(null);
  const [flashGroupId, setFlashGroupId] = useState<string | null>(null);
  const [revertPending, setRevertPending] = useState(false);
  const [ledgerEditField, setLedgerEditField] = useState<LedgerEditField>(null);
  const editSnapshotRef = useRef<ConfirmedPriceGroup | null>(null);
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

  // Reset draft when the picker navigates to a different line — not when the
  // server refetches and swaps order_item ids after an MRP split on the same line.
  useEffect(() => {
    if (!currentItem) return;
    draftState.reset(
      createLineDraft({
        rootOrderItemId: currentItem.id,
        targetQty: pickQuantityTarget(currentItem),
        uom: salesUom(currentItem),
      }),
    );
    setLineOutcome(null);
    setModalOpen(false);
    setModalView('mrp');
    setPriceFixOpen(false);
    setLedgerEditField(null);
    editSnapshotRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when line index changes only
  }, [lineIndex]);

  const shortFlagContext = useMemo(() => {
    if (!currentItem) return undefined;
    const logged = draftState.totalLogged;
    const rem = Math.max(0, targetQty - logged);
    return `You've logged ${logged} of ${targetQty} ${salesUom(currentItem)}. What's wrong with the remaining ${rem}?`;
  }, [currentItem, draftState.totalLogged, targetQty]);

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
    const isOverTarget = totalAfter > targetQty;

    if (isOverTarget && !draftState.draft.noteText.trim()) return;

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
        targetQty,
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

      if (!result.success) return;
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

    const remainingAfter = Math.max(0, targetQty - totalAfter);
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
              payload.group.qty === totalAfter && isFirstSegment ? targetQty : null,
          });
          await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        }
        const remainingAfterUndo = Math.max(0, targetQty - (totalAfter - payload.group.qty));
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
    targetQty,
    undo,
    undoAction,
    userId,
    userName,
    useDemo,
    orderId,
  ]);

  const handleMarkPicked = useCallback(() => {
    if (!currentItem) return;
    appHaptics.impactMedium();
    const logged = draftState.totalLogged;
    setModalOpen(false);
    const outcome: LineOutcome =
      logged >= targetQty
        ? { kind: 'picked', itemId: currentItem.id, pickedQty: logged, targetQty }
        : { kind: 'partial', itemId: currentItem.id, pickedQty: logged, targetQty };
    setLineOutcome(outcome);
    setCompletedLines((prev) => ({
      ...prev,
      [currentItem.id]: outcome.kind === 'picked' ? 'picked' : 'partial',
    }));
    if (!isLab && !useDemo && orderId != null) {
      void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    }
  }, [currentItem, draftState.totalLogged, isLab, orderId, queryClient, targetQty, useDemo]);

  const handleFlagSubmit = useCallback(
    async (payload: FlagSubmitPayload) => {
      if (!currentItem) return;
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
      setModalOpen(false);
      setLineOutcome({
        kind: 'flagged',
        itemId: currentItem.id,
        reason: payload.reason,
        pickedQty: draftState.totalLogged,
        targetQty,
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
      isLab,
      order,
      orderId,
      queryClient,
      targetQty,
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
          targetQty,
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
    targetQty,
    useDemo,
    userId,
  ]);

  const advanceLine = useCallback(() => {
    setLineOutcome(null);
    setLineIndex((i) => Math.min(i + 1, pickItems.length - 1));
    setViewMode('card');
  }, [pickItems.length]);

  const goToLine = useCallback((index: number) => {
    setLineOutcome(null);
    setLineIndex(Math.max(0, Math.min(index, pickItems.length - 1)));
    setViewMode('card');
  }, [pickItems.length]);

  const listRows = useMemo((): PickLineListEntry[] => {
    return pickItems.map((item, index) => {
      const itemTargetQty = pickQuantityTarget(item);
      const completed = completedLines[item.id];
      const isCurrent = index === lineIndex;
      const loggedOnCurrent = isCurrent ? draftState.totalLogged : 0;

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
        pickedQty: completed === 'partial' || (isCurrent && loggedOnCurrent > 0) ? loggedOnCurrent : undefined,
        uom: salesUom(item),
        unitPrice: orderItemUnitPrice(item.price_quoted, item.price_system),
        status,
      };
    });
  }, [completedLines, draftState.totalLogged, lineIndex, pickItems]);

  const doneCount = useMemo(
    () => listRows.filter((row) => row.status === 'picked' || row.status === 'flagged').length,
    [listRows],
  );

  const lineChips = useMemo((): PickLineChip[] => {
    return listRows.map((row, index) => ({
      index,
      status: row.status === 'now' ? 'now' : row.status,
    }));
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

  const remaining = Math.max(0, targetQty - draftState.totalLogged);

  const outcomeHeadline =
    lineOutcome?.kind === 'picked'
      ? `${lineOutcome.pickedQty} ${salesUom(currentItem)} picked ✓`
      : lineOutcome?.kind === 'partial'
        ? `${lineOutcome.pickedQty} of ${lineOutcome.targetQty} picked — billing will review`
        : lineOutcome?.kind === 'flagged'
          ? `Flagged · ${lineOutcome.reason}`
          : '';

  const outcomeDetail =
    lineOutcome && lineOutcome.kind !== 'picked'
      ? `${lineOutcome.pickedQty} of ${lineOutcome.targetQty} logged`
      : undefined;

  const nextItem = pickItems[lineIndex + 1];
  const nextPreview: NextPickLinePreview | null = nextItem
    ? {
        code: partCode(nextItem),
        rackNo: nextItem.rack_no,
        itemName: nextItem.item_name,
        deckIndex: lineIndex + 1,
      }
    : null;

  const finishOrder = onFinish ?? onBack;

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

        {!lineOutcome ? (
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
      {lineOutcome ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <PickLineResolvedDock
            kind={lineOutcome.kind === 'picked' ? 'picked' : lineOutcome.kind === 'partial' ? 'partial' : 'flagged'}
            headline={outcomeHeadline}
            detail={outcomeDetail}
            nextPreview={nextPreview}
            onNext={advanceLine}
            onUndoPick={lineOutcome.kind === 'flagged' ? () => void handleUndoFlag() : undefined}
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
          targetQty={targetQty}
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
          onFlag={() => setFlagOpen(true)}
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
        onShortStock={() => setFlagOpen(true)}
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
        onClose={() => setFlagOpen(false)}
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
