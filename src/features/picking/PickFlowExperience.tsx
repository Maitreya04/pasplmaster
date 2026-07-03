import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CaretLeft } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { FlagReasonSheet, type FlagSubmitPayload } from '../../components/picking/FlagReasonSheet';
import { PickLineResolvedDock } from '../../components/picking/PickLineResolvedDock';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { useOfflinePickSession, useOfflinePicksHydrated } from '../../hooks/useOfflinePicks';
import { useWorkClaim } from '../../hooks/useWorkClaim';
import {
  bootstrapOfflinePickSession,
  isOfflinePickUsable,
  persistSessionPatch,
  readOfflinePickSessionFromMirror,
} from '../../lib/offlinePicks';
import { ensurePickingClaim } from '../../lib/picking/ensurePickingClaim';
import { pickQuantityTarget, pickableOrderItems } from '../../lib/cartSupply';
import type { NextPickLinePreview } from '../../lib/picking/deckOrder';
import { defaultPickItemTransitionAdapter } from '../../lib/picking/itemTransitionAdapter';
import { ensurePendingItem } from '../../lib/billing/ensurePendingItem';
import { deskLineIssueCategory } from '../../lib/billing/deskLineFlagKind';
import {
  isPickNoLongerActiveError,
  pickMutationErrorMessage,
  pickNoLongerActiveMessage,
} from '../../lib/picking/pickSessionErrors';
import { revertPickLine, type RevertPickLineMode } from '../../lib/picking/revertPickLine';
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
  mergeLineDrafts,
  snapshotLineDraft,
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

function requestedLineQty(item: OrderItem): number {
  const requested = Number(item.qty_requested ?? 0);
  if (Number.isFinite(requested) && requested > 0) return Math.floor(requested);
  return pickQuantityTarget(item);
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
  const navigate = useNavigate();
  const { userId, userName } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const offlinePickSession = useOfflinePickSession(
    isLab || useDemo ? null : (orderId ?? null),
  );
  const offlinePickSessionFromMirror = useMemo(
    () =>
      isLab || useDemo || orderId == null
        ? null
        : readOfflinePickSessionFromMirror(orderId),
    [isLab, orderId, offlinePickSession, useDemo],
  );
  const effectiveOfflineSession = offlinePickSession ?? offlinePickSessionFromMirror;
  const offlinePicksHydrated = useOfflinePicksHydrated();
  const offlinePickActive = !isLab && !useDemo && isOfflinePickUsable(effectiveOfflineSession);
  const offlineOrderSnapshot = useMemo(
    () => effectiveOfflineSession?.orderSnapshot ?? null,
    [effectiveOfflineSession?.orderSnapshot],
  );
  const orderQuery = useOrderDetail(useDemo ? null : (orderId ?? null));
  const order: OrderWithItems | null | undefined = useDemo
    ? demoOrder
    : offlinePickActive
      ? offlineOrderSnapshot ?? orderQuery.data ?? null
      : orderQuery.data ?? null;
  const isLoading =
    useDemo ? false : orderQuery.isLoading && !effectiveOfflineSession;
  const error =
    useDemo ? null : orderQuery.error && !effectiveOfflineSession ? orderQuery.error : null;
  const workClaim = useWorkClaim(
    isLab || useDemo || offlinePickActive || !offlinePicksHydrated ? null : (orderId ?? null),
    'picking',
  );

  const resolveClaimForWrite = useCallback(async (): Promise<number | null> => {
    if (isLab || useDemo || orderId == null || !userId) return null;

    if (offlinePickActive && effectiveOfflineSession) {
      let session = await bootstrapOfflinePickSession(effectiveOfflineSession);
      const ensured = await ensurePickingClaim({
        orderId,
        userId,
        claimId: session.claimId,
      });
      if (ensured.claimId && ensured.claimId !== session.claimId) {
        session =
          (await persistSessionPatch(session.clientPickKey, {
            claimId: ensured.claimId,
            lastError: null,
          })) ?? { ...session, claimId: ensured.claimId };
      } else if (ensured.claimId && session.lastError) {
        session =
          (await persistSessionPatch(session.clientPickKey, { lastError: null })) ?? session;
      }
      return ensured.claimId ?? session.claimId;
    }

    const claimResult = await workClaim.claim();
    if (claimResult.success && claimResult.claim_id) {
      return claimResult.claim_id;
    }
    return workClaim.claimId;
  }, [
    effectiveOfflineSession,
    isLab,
    offlinePickActive,
    orderId,
    useDemo,
    userId,
    workClaim,
  ]);

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
  const [revertConfirm, setRevertConfirm] = useState<{
    itemId: number;
    mode: RevertPickLineMode;
    itemName: string;
    kind: 'flag' | 'pick';
  } | null>(null);
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
  const targetQty = currentItem ? requestedLineQty(currentItem) : 0;

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
  const sessionScope = isLab ? 'lab' : 'production';
  const lineDraftsRef = useRef<Record<number, ReturnType<typeof snapshotLineDraft>>>({});

  const persistLineDraft = useCallback(
    (itemId: number, draft: ReturnType<typeof snapshotLineDraft>) => {
      if (useDemo || orderId == null) return;
      lineDraftsRef.current = { ...lineDraftsRef.current, [itemId]: draft };
      const session = readPickFlowSession(orderId, sessionScope);
      writePickFlowSession(
        orderId,
        {
          lineIndex,
          completedLines,
          lineDrafts: { ...(session?.lineDrafts ?? {}), [itemId]: draft },
        },
        sessionScope,
      );
    },
    [completedLines, lineIndex, orderId, sessionScope, useDemo],
  );

  useEffect(() => {
    if (isLab || useDemo || !orderId || !order) return;
    // Local offline session is authoritative right after Start — server cache may still say approved.
    if (offlinePickActive) return;
    if (!offlinePicksHydrated && !readOfflinePickSessionFromMirror(orderId)) {
      if (orderQuery.isLoading || orderQuery.isFetching) return;
    } else if (orderQuery.isLoading || orderQuery.isFetching) {
      return;
    }

    if (order.workflow_status === 'approved') {
      navigate(`/picking/preview/${orderId}?source=assigned`, { replace: true });
      return;
    }
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
  }, [
    isLab,
    navigate,
    offlinePickActive,
    offlinePicksHydrated,
    onBack,
    order,
    orderId,
    orderQuery.isFetching,
    orderQuery.isLoading,
    toast,
    useDemo,
  ]);

  useEffect(() => {
    if (isLab || useDemo || offlinePickActive) return;
    if (order?.workflow_status === 'picking' && !workClaim.isClaimedByMe && !workClaim.error) {
      void workClaim.claim();
    }
  }, [
    isLab,
    offlinePickActive,
    order?.workflow_status,
    useDemo,
    workClaim.claim,
    workClaim.error,
    workClaim.isClaimedByMe,
  ]);

  useEffect(() => {
    if (useDemo || !order || orderId == null || pickItems.length === 0) return;
    if (pickSessionBootstrappedRef.current === orderId) return;
    pickSessionBootstrappedRef.current = orderId;

    const session = readPickFlowSession(orderId, sessionScope);
    const serverCompleted = deriveCompletedLinesFromOrder(pickItems, order.items);
    setCompletedLines({ ...serverCompleted, ...(session?.completedLines ?? {}) });
    if (session?.lineDrafts) {
      lineDraftsRef.current = session.lineDrafts;
    }

    const restoredIndex =
      session?.lineIndex != null &&
      session.lineIndex >= 0 &&
      session.lineIndex < pickItems.length
        ? session.lineIndex
        : 0;
    setLineIndex(restoredIndex);
  }, [isLab, order, orderId, pickItems, sessionScope, useDemo]);

  useEffect(() => {
    if (useDemo || orderId == null) return;
    const session = readPickFlowSession(orderId, sessionScope);
    writePickFlowSession(
      orderId,
      {
        lineIndex,
        completedLines,
        lineDrafts: session?.lineDrafts ?? lineDraftsRef.current,
      },
      sessionScope,
    );
  }, [completedLines, isLab, lineIndex, orderId, sessionScope, useDemo]);

  // Reset draft when the picker navigates to a different line — not when the
  // server refetches and swaps order_item ids after an MRP split on the same line.
  useEffect(() => {
    if (!currentItem || !order) return;
    const serverDraft = buildLineDraftFromOrderItem(currentItem, order.items);
    const sessionDraft =
      lineDraftsRef.current[currentItem.id] ?? readPickFlowSession(orderId ?? 0, sessionScope)?.lineDrafts?.[currentItem.id];
    draftState.reset(mergeLineDrafts(serverDraft, sessionDraft));
    setLineOutcome(null);
    setModalOpen(false);
    setModalView('mrp');
    setPriceFixOpen(false);
    setLedgerEditField(null);
    editSnapshotRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when line index changes only
  }, [lineIndex]);

  useEffect(() => {
    if (!currentItem || useDemo || orderId == null) return;
    if (draftState.draft.confirmedGroups.length === 0 && draftState.totalLogged === 0) return;
    persistLineDraft(currentItem.id, snapshotLineDraft(draftState.draft));
  }, [
    currentItem,
    draftState.draft.confirmedGroups,
    draftState.draft.targetQty,
    draftState.totalLogged,
    orderId,
    persistLineDraft,
    useDemo,
  ]);

  /** Frozen when the line opens — do not use live order_item qty after MRP splits. */
  const lineTargetQty = draftState.draft.targetQty;

  const shortFlagContext = useMemo(() => {
    if (!currentItem || flagSheetMode !== 'short') return undefined;
    const logged = draftState.totalLogged;
    const rem = Math.max(0, lineTargetQty - logged);
    if (rem <= 0) return undefined;
    return `Shipping ${logged} of ${lineTargetQty} ${salesUom(currentItem)}. Why are ${rem} missing?`;
  }, [currentItem, draftState.totalLogged, flagSheetMode, lineTargetQty]);

  const openPickModal = useCallback(() => {
    editSnapshotRef.current = null;
    setLedgerEditField(null);
    sessionSuggestedRef.current = {
      mrp: null,
      source: 'empty',
      stockMrp: null,
      historyCount: 0,
    };

    const groups = draftState.draft.confirmedGroups;
    const lastGroup = groups[groups.length - 1];
    const rem = Math.max(0, lineTargetQty - draftState.totalLogged);

    if (lastGroup && rem > 0) {
      draftState.resumePick(lastGroup.mrp, rem);
      sessionSuggestedRef.current = {
        mrp: lastGroup.mrp,
        source: 'empty',
        stockMrp: null,
        historyCount: 0,
      };
      setModalView('qty');
    } else {
      draftState.startPick();
      setModalView('mrp');
    }
    setModalOpen(true);
  }, [draftState, lineTargetQty]);

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
      const activeClaimId = await resolveClaimForWrite();
      const result = await commit({
        orderId: order.id,
        claimId: activeClaimId,
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
          const activeClaimId = await resolveClaimForWrite();
          await undo({
            orderId: order.id,
            claimId: activeClaimId,
            userId,
            rootOrderItemId: payload.rootOrderItemId,
            segmentOrderItemId: payload.group.orderItemId,
            restoreQty:
              payload.group.qty === totalAfter && isFirstSegment ? lineTargetQty : null,
          });
          await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        }
        if (currentItem) {
          const groupsAfter = draftState.draft.confirmedGroups.filter(
            (g) => g.id !== payload.group.id,
          );
          persistLineDraft(
            currentItem.id,
            snapshotLineDraft({ ...draftState.draft, confirmedGroups: groupsAfter }),
          );
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
    persistLineDraft,
    resolveClaimForWrite,
  ]);

  const finishOrder = onFinish ?? onBack;

  /** Advance past the current line — finishes the order instead of stalling
   * when nothing is left to pick (e.g. flagging the last outstanding line). */
  const advanceLine = useCallback(() => {
    const next = findNextPendingLineIndex(pickItems, lineIndex, completedLines);
    if (next == null) {
      setLineOutcome(null);
      finishOrder();
      return;
    }
    setLineOutcome(null);
    setViewMode('card');
    setLineIndex(next);
  }, [completedLines, finishOrder, lineIndex, pickItems]);

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
            const qtyPending = lineTargetQty;
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
    if (!currentItem) return;
    const isFlagged =
      completedLines[currentItem.id] === 'flagged' || lineOutcome?.kind === 'flagged';
    if (!isFlagged) return;
    if (!useDemo && !isLab && (!order || !userId)) return;

    setRevertPending(true);
    try {
      if (!isLab && !useDemo && order && userId) {
        const activeClaimId = await resolveClaimForWrite();
        const result = await revertPickLine({
          orderId: order.id,
          claimId: activeClaimId,
          userId,
          orderItemId: currentItem.id,
          mode: 'full',
        });
        if (!result.success) {
          const errorCode = result.error ?? 'revert_failed';
          if (isPickNoLongerActiveError(errorCode)) {
            toast.info(pickNoLongerActiveMessage(errorCode));
            if (orderId != null) {
              void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
            }
            onBack();
            return;
          }
          toast.error(pickMutationErrorMessage(errorCode, 'Could not remove flag'));
          return;
        }
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
      persistLineDraft(
        currentItem.id,
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
      appHaptics.impactLight();
      toast.info('Flag removed — pick this line again');
    } finally {
      setRevertPending(false);
    }
  }, [
    completedLines,
    currentItem,
    draftState,
    isLab,
    lineOutcome,
    lineTargetQty,
    onBack,
    order,
    orderId,
    persistLineDraft,
    queryClient,
    resolveClaimForWrite,
    toast,
    useDemo,
    userId,
  ]);

  const handleUndoGroup = useCallback(
    async (groupId: string) => {
      if (!currentItem || !order) return;
      const groups = draftState.draft.confirmedGroups;
      const targetGroup = groups.find((g) => g.id === groupId);
      const lastGroup = groups[groups.length - 1];
      if (!targetGroup || !lastGroup || targetGroup.id !== lastGroup.id) {
        toast.error('Undo the most recent batch first');
        return;
      }

      const isFirstSegment = groups.length === 1;
      const totalAfterUndo = draftState.totalLogged - targetGroup.qty;

      setRevertPending(true);
      try {
        if (!isLab && !useDemo && userId && orderId != null) {
          const activeClaimId = await resolveClaimForWrite();
          const result = await undo({
            orderId: order.id,
            claimId: activeClaimId,
            userId,
            rootOrderItemId: draftState.draft.rootOrderItemId,
            segmentOrderItemId: targetGroup.orderItemId,
            restoreQty:
              isFirstSegment && totalAfterUndo === 0 ? lineTargetQty : null,
          });
          if (!result.success) {
            toast.error(
              pickMutationErrorMessage(result.error, 'Could not undo batch'),
            );
            return;
          }
          await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        }

        draftState.popLastGroup();
        const nextDraft = snapshotLineDraft({
          ...draftState.draft,
          confirmedGroups: groups.slice(0, -1),
        });
        persistLineDraft(currentItem.id, nextDraft);
        appHaptics.impactLight();
        toast.info('Last batch removed');
        undoAction.dismiss();

        if (totalAfterUndo > 0) {
          setModalView('gap');
          setModalOpen(true);
        } else {
          setModalOpen(false);
        }
      } finally {
        setRevertPending(false);
      }
    },
    [
      currentItem,
      draftState,
      isLab,
      lineTargetQty,
      order,
      orderId,
      persistLineDraft,
      queryClient,
      resolveClaimForWrite,
      toast,
      undo,
      undoAction,
      useDemo,
      userId,
    ],
  );

  const executeClearPick = useCallback(
    async (itemId: number, mode: RevertPickLineMode) => {
      if (!order || !currentItem || currentItem.id !== itemId) return;
      if (!useDemo && !isLab && !userId) return;

      const wasFlagged = completedLines[itemId] === 'flagged';

      setRevertPending(true);
      setRevertConfirm(null);
      try {
        if (!isLab && !useDemo && userId) {
          const activeClaimId = await resolveClaimForWrite();
          const result = await revertPickLine({
            orderId: order.id,
            claimId: activeClaimId,
            userId,
            orderItemId: draftState.draft.rootOrderItemId,
            mode,
            restoreQty: mode === 'full' ? lineTargetQty : null,
          });
          if (!result.success) {
            const errorCode = result.error ?? 'revert_failed';
            if (isPickNoLongerActiveError(errorCode)) {
              toast.info(pickNoLongerActiveMessage(errorCode));
              if (orderId != null) {
                void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
              }
              onBack();
              return;
            }
            toast.error(pickMutationErrorMessage(errorCode, 'Could not reset this line'));
            return;
          }
          if (orderId != null) {
            await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
          }
        }

        const freshDraft = createLineDraft({
          rootOrderItemId: currentItem.id,
          targetQty: lineTargetQty,
          uom: salesUom(currentItem),
        });
        draftState.reset(freshDraft);
        persistLineDraft(currentItem.id, freshDraft);
        setCompletedLines((prev) => {
          const next = { ...prev };
          delete next[currentItem.id];
          return next;
        });
        setLineOutcome(null);
        setModalOpen(false);
        undoAction.dismiss();
        appHaptics.impactLight();
        toast.info(
          mode === 'full' && wasFlagged
            ? 'Flag removed — pick this line again'
            : mode === 'full'
              ? 'Pick removed — start over'
              : 'Qty reset',
        );
      } finally {
        setRevertPending(false);
      }
    },
    [
      completedLines,
      currentItem,
      draftState,
      isLab,
      lineTargetQty,
      onBack,
      order,
      orderId,
      persistLineDraft,
      queryClient,
      resolveClaimForWrite,
      toast,
      undoAction,
      useDemo,
      userId,
    ],
  );

  const requestClearPick = useCallback(() => {
    if (!currentItem) return;
    appHaptics.selection();
    setRevertConfirm({
      itemId: currentItem.id,
      mode: 'full',
      itemName: currentItem.item_name,
      kind: 'pick',
    });
  }, [currentItem]);

  const requestRevertClosedLine = useCallback(() => {
    if (!currentItem) return;
    const status = completedLines[currentItem.id];
    if (status !== 'flagged' && status !== 'picked' && status !== 'partial') return;
    appHaptics.selection();
    setRevertConfirm({
      itemId: currentItem.id,
      mode: 'full',
      itemName: currentItem.item_name,
      kind: status === 'flagged' ? 'flag' : 'pick',
    });
  }, [completedLines, currentItem]);

  const goToLine = useCallback((index: number) => {
    setLineOutcome(null);
    setLineIndex(Math.max(0, Math.min(index, pickItems.length - 1)));
    setViewMode('card');
  }, [pickItems.length]);

  const listRows = useMemo((): PickLineListEntry[] => {
    if (!order) return [];
    const sessionDrafts = readPickFlowSession(orderId ?? null, sessionScope)?.lineDrafts;
    return pickItems.map((item, index) => {
      const serverDraft = buildLineDraftFromOrderItem(item, order.items);
      const itemDraft = mergeLineDrafts(
        serverDraft,
        lineDraftsRef.current[item.id] ?? sessionDrafts?.[item.id],
      );
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
  }, [completedLines, draftState.totalLogged, lineIndex, order, orderId, pickItems, sessionScope]);

  const doneCount = useMemo(
    () =>
      listRows.filter(
        (row) =>
          row.status === 'picked' || row.status === 'partial' || row.status === 'flagged',
      ).length,
    [listRows],
  );
  const allLinesClosed = pickItems.length > 0 && doneCount >= pickItems.length;

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
            {allLinesClosed ? (
              <button
                type="button"
                onClick={finishOrder}
                className="mt-2 flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--bg-positive)] px-4 font-ds-caption-size font-extrabold text-[var(--content-on-color)] pick-pressable"
              >
                All lines handled · Finish order →
              </button>
            ) : null}
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
          onShortPick={() => {
            setFlagSheetMode('short');
            setFlagOpen(true);
          }}
          onEditPick={openPickModal}
          onEditGroupMrp={openEditGroupMrp}
          onEditGroupQty={openEditGroupQty}
          onUndoGroup={(groupId) => void handleUndoGroup(groupId)}
          onClearPick={requestClearPick}
          onUndoLine={
            markedStatus === 'flagged' ||
            markedStatus === 'picked' ||
            markedStatus === 'partial'
              ? requestRevertClosedLine
              : undefined
          }
          undoLinePending={revertPending}
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
        onUndoGroup={(groupId) => void handleUndoGroup(groupId)}
        onClearPick={requestClearPick}
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
          // Close the pick-entry sheet before opening the flag sheet — otherwise
          // both bottom sheets render at once ("double dialog"). Preserve
          // already-logged qty as a short pick; only treat it as a fresh
          // out-of-stock flag when nothing has been logged yet.
          setFlagSheetMode(draftState.totalLogged > 0 ? 'short' : 'issue');
          setModalOpen(false);
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
        title={flagSheetMode === 'short' ? 'Short pick' : 'Report issue'}
        hint={
          flagSheetMode === 'short'
            ? 'Pick why the rest is missing. Billing ships what you already logged.'
            : undefined
        }
        contextBanner={shortFlagContext}
      />

      {undoAction.toast ? (
        <UndoToast
          toast={undoAction.toast}
          onUndo={() => void undoAction.runUndo()}
        />
      ) : null}

      {revertConfirm ? (
        <ConfirmDialog
          title={revertConfirm.kind === 'flag' ? 'Undo this flag?' : 'Remove this pick?'}
          description={
            revertConfirm.kind === 'flag'
              ? `Put ${revertConfirm.itemName} back on your pick list. Billing won't keep this flag.`
              : `Clear all logged qty and MRP on ${revertConfirm.itemName}. You'll pick this line again from scratch.`
          }
          confirmLabel={revertConfirm.kind === 'flag' ? 'Undo flag' : 'Remove pick'}
          cancelLabel={revertConfirm.kind === 'flag' ? 'Keep flag' : 'Keep pick'}
          tone="danger"
          isSubmitting={revertPending}
          onCancel={() => {
            if (revertPending) return;
            setRevertConfirm(null);
          }}
          onConfirm={() => void executeClearPick(revertConfirm.itemId, revertConfirm.mode)}
        />
      ) : null}
    </div>
  );
}
