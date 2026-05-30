import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  CaretLeft,
  Warning,
  ArrowRight,
  ArrowCounterClockwise,
  Flask,
} from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase/client';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { useWorkClaim } from '../../hooks/useWorkClaim';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import {
  BigButton,
  BottomSheet,
  Skeleton,
  StatusBadge,
} from '../../components/shared';
import type { OrderItem, OrderItemState, ScanResult } from '../../types';
import { PickCompleteScreen } from './PickCompleteScreen';
import { type QueueSheetRow } from './QueueSheet';
import type { SwipeDeckDotStatus } from '../../components/picking/SwipeDeck';
import { PickSwipeDeck } from '../../components/picker-v10/PickSwipeDeck';
import { PickCard } from '../../components/picking/PickCard';
import {
  PickLineStatusPanel,
  type PickLineStatusRow,
} from '../../components/picking/PickLineStatusPanel';
import {
  resolvePickLineStatus,
  resolveQueueSheetLineStatus,
} from '../../lib/picking/pickLineStatus';
import { JumpListSheet } from '../../components/picking/JumpListSheet';
import { TransportChip } from '../../components/picking/TransportChip';
import {
  formatBilledLabel,
  formatLineCountLabel,
} from '../../lib/picking/pickQueueDisplay';
import { FlagReasonSheet, type FlagSubmitPayload } from '../../components/picking/FlagReasonSheet';
import {
  buildDeckOrder,
  findDeckIndexByItemId,
  nextPickLinePreview,
  nextPickableIndex,
  orderItemBrandLabel,
  sortPickWalkOrder,
  wrapIndex,
} from '../../lib/picking/deckOrder';
import { pickQuantityTarget, pickableOrderItems } from '../../lib/cartSupply';
import {
  pickOutcomeDetail,
  pickOutcomeHeadline,
  resolvePickOutcomeKind,
} from '../../lib/picking/pickLineOutcome';
import { appHaptics } from '../../lib/haptics';
import { sendInternalNotification } from '../../lib/pickerPush';
import { LiveQrScanner, type LiveQrScannerResolved } from '../../components/shared/LiveQrScanner';
import {
  PACK_DEFINITIONS_QUERY_KEY,
  fetchItemPackDefinitions,
  type ItemPackDefinition,
} from '../../lib/packLpn';
import { deriveBusyCodeCandidates } from '../../lib/scanner/deriveBusyCodeCandidates';
import {
  classifyScanPayload,
  parsePackPickPayload,
  parseLpnPickPayload,
  rackCodesMatch,
} from '../../lib/scanner/qrPayload';
import { formatUomPickHint } from '../../lib/scanner/uomMapper';
import {
  defaultPickItemTransitionAdapter,
  sandboxPickItemTransitionAdapter,
  type PickItemTransition,
} from '../../lib/picking/itemTransitionAdapter';
import {
  binIdForPickItem,
  consumeBinLayerForPick,
  fetchBinPickerShelf,
  orderItemUsesStagingOnly,
  primaryBusyCodeForOrderItem,
  rackGateBinIdForPickItem,
  STAGING_BIN_DEFAULT,
} from '../../lib/wms/binLayers';
import { MrpHistorySheet } from '../../components/picker-v10/MrpHistorySheet';
import { PickQtySheet } from '../../components/picking/PickQtySheet';
import { useStockMrpHistory } from '../../hooks/useStockMrpHistory';
import { STOCK_MRP_HISTORY_QUERY_KEY } from '../../lib/stockMrpwise';
import {
  commitActiveSegment,
  createDefaultPickLineMrpState,
  distinctShelfMrpCount,
  enterSingleModeFromSplit,
  enterSplitMode,
  getActiveSegment,
  isSplitInProgress,
  isSplitMode,
  mergeMrpIntoScanResult,
  pickLineMrpLookup,
  pickLineSegmentsCommittedQty,
  pickLineSplitRemaining,
  readPickLineMrpMap,
  shouldSuggestMrpSplit,
  startActiveSegment,
  writePickLineMrpMap,
  type PickLineMrpState,
} from '../../lib/picking/pickLineMrp';
import { commitPickMrpSegment, undoPickMrpSegment } from '../../lib/picking/splitMrpSegment';
import {
  revertPickLine,
  type RevertPickLineMode,
} from '../../lib/picking/revertPickLine';
import type { StockLocationCode } from '../../types';

type PickItemUiState =
  | 'pending'
  | 'scanning'
  | 'matched'
  | 'warning'
  | 'error'
  | 'picked'
  | 'flagged'
  | 'overridden';

interface PickItemLocal {
  orderItem: OrderItem;
  uiState: PickItemUiState;
  scanResult: ScanResult | null;
}

interface PendingPackConfirmation {
  orderItemId: number;
  scanResult: ScanResult;
  suggestedQty: number;
  targetQty: number;
}

const DUPLICATE_SCAN_WINDOW_MS = 500;
const MAX_AUTO_SCAN_QTY = 12;

// ─── Pick flow constants ───
// Line outcome stays until picker taps Confirm & next (no silent auto-advance).
// 5s undo window. Slips happen; mistakes get flagged. Five seconds is the
// sweet spot we tested behaviourally — long enough to react, short enough
// not to slow the next pick.
const UNDO_DURATION_MS = 5000;

export type PickFlowMode = 'production' | 'lab';

function pickStorageKeys(mode: PickFlowMode) {
  const prefix = mode === 'lab' ? 'paspl.pick.lab' : 'paspl.pick';
  return {
    cardIndex: `${prefix}.cardIndex.v1`,
    rackVerified: `${prefix}.rackVerified.v1`,
    skipped: `${prefix}.skipped.v1`,
  };
}

export interface PickFlowPanelProps {
  orderId: number;
  mode?: PickFlowMode;
  onBack: () => void;
}

function readIdSet(storageKey: string, orderId: number | null): Set<number> {
  if (!orderId || typeof window === 'undefined') return new Set();
  try {
    const raw = window.sessionStorage.getItem(`${storageKey}:${orderId}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is number => typeof v === 'number'));
  } catch {
    return new Set();
  }
}

function writeIdSet(storageKey: string, orderId: number | null, ids: Set<number>): void {
  if (!orderId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${storageKey}:${orderId}`, JSON.stringify([...ids]));
  } catch {
    // Quota / private mode — best-effort persistence.
  }
}

function readCardIndex(storageKey: string, orderId: number | null): number {
  if (!orderId || typeof window === 'undefined') return 0;
  try {
    const raw = window.sessionStorage.getItem(`${storageKey}:${orderId}`);
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeCardIndex(storageKey: string, orderId: number | null, index: number): void {
  if (!orderId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${storageKey}:${orderId}`, String(index));
  } catch {
    // best-effort
  }
}

interface LineOutcomeState {
  itemId: number;
  kind: 'picked' | 'partial' | 'flagged';
  reason?: string | null;
  pickedQty?: number;
}

interface UndoSnapshot {
  itemId: number;
  itemName: string;
  itemCode: string | null;
  previousScanResult: ScanResult | null;
  previousState: OrderItemState;
  expiresAt: number;
}

function partitionItems(items: PickItemLocal[]): {
  active: PickItemLocal[];
  done: PickItemLocal[];
} {
  const active: PickItemLocal[] = [];
  const done: PickItemLocal[] = [];
  for (const item of items) {
    if (
      item.uiState === 'picked' ||
      item.uiState === 'flagged' ||
      item.uiState === 'overridden'
    ) {
      done.push(item);
    } else {
      active.push(item);
    }
  }
  return { active, done };
}

function uiStateFromDb(oi: OrderItem): PickItemUiState {
  if (oi.state === 'picked') return 'picked';
  if (oi.state === 'flagged') return 'flagged';
  if (oi.scan_result) {
    const res = oi.scan_result;
    if (res?.isMatch) return 'matched';
    if ((res?.confidence || 0) >= 35) return 'warning';
    return 'error';
  }
  return 'pending';
}

function getPickedQtyFromResult(result: ScanResult | null | undefined): number {
  return Math.max(0, result?.progress?.pickedQty ?? 0);
}

export function PickFlowPanel({
  orderId,
  mode = 'production',
  onBack,
}: PickFlowPanelProps): React.JSX.Element | null {
  const isLab = mode === 'lab';
  const storageKeys = pickStorageKeys(mode);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userName, userId } = useAuth();
  const transitionAdapter = isLab
    ? sandboxPickItemTransitionAdapter
    : defaultPickItemTransitionAdapter;

  const { data: order, isLoading, error } = useOrderDetail(orderId);

  useEffect(() => {
    if (isLab || !orderId || !order) return;
    if (order.workflow_status === 'approved') {
      navigate(`/picking/preview/${orderId}?source=assigned`, { replace: true });
    }
  }, [isLab, navigate, order, orderId]);

  const workClaim = useWorkClaim(isLab ? null : orderId, 'picking');
  const claimId = isLab ? null : workClaim.claimId;
  const isClaimedByMe = isLab ? false : workClaim.isClaimedByMe;
  const claim = isLab ? undefined : workClaim.claim;
  const claimError = isLab ? null : workClaim.error;

  useEffect(() => {
    if (isLab) return;
    if (order?.workflow_status === 'picking' && !isClaimedByMe && !claimError) {
      claim?.();
    }
  }, [isLab, order?.workflow_status, isClaimedByMe, claim, claimError]);

  const [localItems, setLocalItems] = useState<Map<number, Partial<PickItemLocal>>>(
    new Map(),
  );

  const [pendingPackConfirmation, setPendingPackConfirmation] =
    useState<PendingPackConfirmation | null>(null);
  const [manualQtyTargetItemId, setManualQtyTargetItemId] = useState<number | null>(null);
  const [manualQtyInitial, setManualQtyInitial] = useState(1);
  const [engagedScanner, setEngagedScanner] = useState<{
    itemId: number;
    mode: 'rack' | 'item';
  } | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const [scannerHint, setScannerHint] = useState<string | null>(null);
  const [lastScanMeta, setLastScanMeta] = useState<{
    rawValue: string;
    at: number;
  } | null>(null);

  // ─── Phase machine state ───
  const [rackVerifiedIds, setRackVerifiedIds] = useState<Set<number>>(new Set());
  // skippedIds: items the picker chose to come back to. Sorted to the end of
  // the queue so the natural rack-order keeps leading the route.
  const [skippedIds, setSkippedIds] = useState<Set<number>>(new Set());
  // lineOutcome: closure beat after pick or flag — green/amber card + explicit Next CTA.
  const [lineOutcome, setLineOutcome] = useState<LineOutcomeState | null>(null);
  // undoSnapshot: 5s window to revert the last completion. Captures the prior
  // scan_result + state so we can roll back both DB and local UI cleanly.
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [queueSheetOpen, setQueueSheetOpen] = useState(true);
  const [queueDragProgress, setQueueDragProgress] = useState(0);
  const [completeSheetOpen, setCompleteSheetOpen] = useState(false);
  const [flagSheetOpen, setFlagSheetOpen] = useState(false);
  const [flagTargetItemId, setFlagTargetItemId] = useState<number | null>(null);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [preferredPickLayer, setPreferredPickLayer] = useState<{
    orderItemId: number;
    layerId: number;
  } | null>(null);
  const [fifoOverrideSheet, setFifoOverrideSheet] = useState<{
    orderItemId: number;
    qtyDelta: number;
    qtyToApply: number;
    resume: 'manual' | 'scan';
    scanFinalize?: {
      progressedResult: ScanResult;
      nextRemaining: number;
      previousScanResult: ScanResult | null;
      suggestedLabel: string;
      classifiedKind: string;
    };
  } | null>(null);
  const [fifoOverrideReason, setFifoOverrideReason] = useState('');
  const [lineMrpMap, setLineMrpMap] = useState<Map<number, PickLineMrpState>>(() => new Map());
  const [mrpSheetItemId, setMrpSheetItemId] = useState<number | null>(null);
  /** Avoid stale lineMrpMap when opening the sheet right after enterSplitMode. */
  const [mrpSheetBatchMode, setMrpSheetBatchMode] = useState(false);
  const [revertConfirm, setRevertConfirm] = useState<{
    itemId: number;
    mode: RevertPickLineMode;
    itemName: string;
  } | null>(null);
  const [revertPickPending, setRevertPickPending] = useState(false);

  const orderItems = useMemo(
    () => (order?.items ? pickableOrderItems(order.items) : undefined),
    [order?.items],
  );

  // Hydrate per-order state from sessionStorage so a refresh doesn't force the
  // picker to re-scan racks mid-flow.
  useEffect(() => {
    if (!orderId) return;
    setRackVerifiedIds(readIdSet(storageKeys.rackVerified, orderId));
    setSkippedIds(readIdSet(storageKeys.skipped, orderId));
    setCurrentCardIndex(readCardIndex(storageKeys.cardIndex, orderId));
    setLineMrpMap(readPickLineMrpMap(orderId, isLab ? 'lab' : 'production'));
  }, [orderId, isLab, storageKeys.cardIndex, storageKeys.rackVerified, storageKeys.skipped]);

  useEffect(() => {
    writePickLineMrpMap(orderId, lineMrpMap, isLab ? 'lab' : 'production');
  }, [orderId, lineMrpMap, isLab]);

  useEffect(() => {
    writeIdSet(storageKeys.rackVerified, orderId, rackVerifiedIds);
  }, [orderId, rackVerifiedIds, storageKeys.rackVerified]);

  useEffect(() => {
    writeIdSet(storageKeys.skipped, orderId, skippedIds);
  }, [orderId, skippedIds, storageKeys.skipped]);

  useEffect(() => {
    writeCardIndex(storageKeys.cardIndex, orderId, currentCardIndex);
  }, [orderId, currentCardIndex, storageKeys.cardIndex]);

  // Auto-dismiss the undo toast after its window.
  useEffect(() => {
    if (!undoSnapshot) return;
    const remaining = Math.max(0, undoSnapshot.expiresAt - Date.now());
    const t = setTimeout(() => setUndoSnapshot(null), remaining);
    return () => clearTimeout(t);
  }, [undoSnapshot]);

  const { data: packDefinitions = [] } = useQuery({
    queryKey: PACK_DEFINITIONS_QUERY_KEY,
    queryFn: fetchItemPackDefinitions,
    staleTime: 5 * 60 * 1000,
  });
  const packDefinitionByBusyCode = useMemo(
    () => new Map(packDefinitions.map((row) => [row.busy_code, row])),
    [packDefinitions],
  );
  const packDefinitionByItemId = useMemo(() => {
    const map = new Map<number, ItemPackDefinition>();
    for (const row of packDefinitions) {
      if (row.item_id_snapshot != null) map.set(row.item_id_snapshot, row);
    }
    return map;
  }, [packDefinitions]);

  const pickItems = useMemo(() => {
    if (!orderItems) return [];
    const sorted = sortPickWalkOrder(orderItems);
    return sorted.map((oi): PickItemLocal => {
      const local = localItems.get(oi.id);
      let uiState = local?.uiState ?? uiStateFromDb(oi);
      const scanResult = local?.scanResult ?? oi.scan_result;
      const lineMrp = lineMrpMap.get(oi.id);
      if (isSplitInProgress(lineMrp, pickQuantityTarget(oi))) {
        uiState = 'matched';
      }
      return {
        orderItem: oi,
        uiState,
        scanResult,
      };
    });
  }, [lineMrpMap, localItems, orderItems]);

  const { active } = useMemo(() => partitionItems(pickItems), [pickItems]);

  // Re-order active so skipped items go to the end while preserving brand walk order
  // within each group. Norman: "natural mapping" — the queue follows the walk,
  // skips peel off to the back like a postman re-attempting delivery.
  const orderedActive = useMemo(() => {
    if (skippedIds.size === 0) return active;
    return [...active].sort((a, b) => {
      const aSkip = skippedIds.has(a.orderItem.id) ? 1 : 0;
      const bSkip = skippedIds.has(b.orderItem.id) ? 1 : 0;
      return aSkip - bSkip;
    });
  }, [active, skippedIds]);

  const deckItems = useMemo(
    () => buildDeckOrder(pickItems, skippedIds),
    [pickItems, skippedIds],
  );

  const safeCardIndex = deckItems.length > 0 ? wrapIndex(currentCardIndex, deckItems.length) : 0;
  const currentDeckItem = deckItems[safeCardIndex] ?? null;
  const currentTarget = currentDeckItem ?? orderedActive[0] ?? null;

  const mountedDeckIndices = useMemo(() => {
    const len = deckItems.length;
    if (len === 0) return new Set<number>();
    if (len <= 3) return new Set(Array.from({ length: len }, (_, i) => i));
    return new Set([
      safeCardIndex,
      wrapIndex(safeCardIndex - 1, len),
      wrapIndex(safeCardIndex + 1, len),
    ]);
  }, [deckItems.length, safeCardIndex]);

  useEffect(() => {
    setEngagedScanner(null);
  }, [safeCardIndex]);

  useEffect(() => {
    if (
      flagSheetOpen ||
      queueSheetOpen ||
      completeSheetOpen ||
      manualQtyTargetItemId !== null ||
      pendingPackConfirmation !== null ||
      fifoOverrideSheet !== null
    ) {
      setEngagedScanner(null);
    }
  }, [
    flagSheetOpen,
    queueSheetOpen,
    completeSheetOpen,
    manualQtyTargetItemId,
    pendingPackConfirmation,
    fifoOverrideSheet,
  ]);

  // Trip brief lives on PickPreviewPage — once picking starts, go straight to the deck.

  // Build the QueueSheet view-model in one place.
  const queueSheetRows: QueueSheetRow[] = useMemo(() => {
    const rows: QueueSheetRow[] = [];
    for (const pi of deckItems) {
      const isCurrent = currentDeckItem?.orderItem.id === pi.orderItem.id;
      const targetQty = pickQuantityTarget(pi.orderItem);
      const pickedQty = Math.min(
        targetQty,
        getPickedQtyFromResult(pi.scanResult),
      );
      const status = resolveQueueSheetLineStatus({
        isCurrent,
        uiState: pi.uiState,
        pickedQty,
        targetQty,
        isSkipped: skippedIds.has(pi.orderItem.id),
        lineClosure:
          lineOutcome?.itemId === pi.orderItem.id ? lineOutcome.kind : null,
      });
      rows.push({
        itemId: pi.orderItem.id,
        rackNo: pi.orderItem.rack_no,
        itemCode:
          pi.orderItem.catalog_alias1 ??
          pi.orderItem.catalog_alias ??
          pi.orderItem.item_alias ??
          null,
        itemName: pi.orderItem.item_name,
        brandLabel: orderItemBrandLabel(pi.orderItem),
        targetQty,
        status,
      });
    }
    return rows;
  }, [deckItems, currentDeckItem, lineOutcome, skippedIds]);

  const counts = useMemo(() => {
    let picked = 0;
    let flagged = 0;
    for (const pi of pickItems) {
      if (pi.uiState === 'picked' || pi.uiState === 'overridden') picked++;
      else if (pi.uiState === 'flagged') flagged++;
    }
    return {
      picked,
      flagged,
      total: pickItems.length,
      remaining: pickItems.length - picked - flagged,
    };
  }, [pickItems]);

  const pieceTotals = useMemo(() => {
    let target = 0;
    let picked = 0;
    for (const pi of pickItems) {
      const lineTarget = pickQuantityTarget(pi.orderItem);
      target += lineTarget;
      const linePicked = Math.min(lineTarget, getPickedQtyFromResult(pi.scanResult));
      picked += linePicked;
    }
    return { target, picked };
  }, [pickItems]);

  const allDone = counts.remaining === 0 && counts.total > 0;
  const hasFlagged = counts.flagged > 0;

  useEffect(() => {
    if (allDone) setCompleteSheetOpen(true);
  }, [allDone]);
  const visibility = useMemo(() => {
    let packAssisted = 0;
    let manual = 0;
    const reasonCounts = new Map<string, number>();
    for (const pi of pickItems) {
      if (pi.scanResult?.packAssist) packAssisted += 1;
      if (pi.scanResult?.operatorContext?.source === 'manual') manual += 1;
      const reason = pi.orderItem.flag_reason;
      if (reason) reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    return {
      packAssisted,
      manual,
      reasonBadges: [...reasonCounts.entries()],
    };
  }, [pickItems]);

  const updateLocalItem = useCallback(
    (itemId: number, update: Partial<PickItemLocal>) => {
      setLocalItems((prev) => {
        const next = new Map(prev);
        const existing = next.get(itemId) ?? {};
        next.set(itemId, { ...existing, ...update });
        return next;
      });
    },
    [],
  );

  /**
   * Mark a rack verified for the current item. Triggered either by a successful
   * rack QR scan, or by long-pressing the rack number when no QR is available
   * yet — the constraint-bypass case Norman would call a "deliberate override".
   */
  const markRackVerified = useCallback(
    (itemId: number, source: 'scan' | 'override') => {
      setRackVerifiedIds((prev) => {
        if (prev.has(itemId)) return prev;
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });
      appHaptics.success();
      if (source === 'override') {
        setScannerHint('Rack marked verified manually. Pick carefully.');
      }
    },
    [],
  );

  /** Add an item to the "skipped" set so it sorts to the end of the queue. */
  const skipItem = useCallback((itemId: number, _reason: string) => {
    void _reason;
    setSkippedIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
    appHaptics.impactLight();
    toast.info('Skipped — will return at the end of the queue.');
  }, [toast]);

  const advanceNextPreview = useMemo(
    () => nextPickLinePreview(deckItems, safeCardIndex),
    [deckItems, safeCardIndex],
  );

  const advanceToNextItem = useCallback(() => {
    appHaptics.impactMedium();
    setLineOutcome(null);
    setCurrentCardIndex((idx) => {
      const next = nextPickableIndex(deckItems, idx);
      return next ?? idx;
    });
  }, [deckItems]);

  const handleCardIndexChange = useCallback((index: number) => {
    setLineOutcome(null);
    setCurrentCardIndex(index);
  }, []);

  const jumpToItem = useCallback(
    (itemId: number) => {
      const idx = findDeckIndexByItemId(deckItems, itemId);
      handleCardIndexChange(idx);
      setQueueSheetOpen(false);
      appHaptics.selection();
    },
    [deckItems, handleCardIndexChange],
  );

  const beginLineOutcome = useCallback((outcome: LineOutcomeState) => {
    setLineOutcome(outcome);
  }, []);

  const openFlagSheet = useCallback((itemId: number) => {
    appHaptics.selection();
    setFlagTargetItemId(itemId);
    setFlagSheetOpen(true);
  }, []);

  const engagedScannerContext = useMemo(() => {
    if (!engagedScanner) return null;
    const deckItem = deckItems.find((pi) => pi.orderItem.id === engagedScanner.itemId);
    if (!deckItem) return null;

    const orderItem = deckItem.orderItem;
    const targetQty = pickQuantityTarget(orderItem);
    const pickedQty = Math.min(targetQty, getPickedQtyFromResult(deckItem.scanResult));
    const partNo =
      orderItem.catalog_alias1 ??
      orderItem.catalog_alias ??
      orderItem.item_alias ??
      String(orderItem.item_id);
    const busyCodes = deriveBusyCodeCandidates(orderItem);
    const mode = engagedScanner.mode;

    return {
      orderItem,
      mode,
      targetQty,
      pickedQty,
      partNo,
      busyCode: busyCodes[0] ?? null,
      title:
        mode === 'rack'
          ? `Scan bin · Rack ${orderItem.rack_no ?? '—'}`
          : partNo,
      eyebrow: mode === 'rack' ? 'Bin verification' : 'Product scan',
    };
  }, [deckItems, engagedScanner]);

  const shelfBinId =
    currentDeckItem && rackVerifiedIds.has(currentDeckItem.orderItem.id)
      ? rackGateBinIdForPickItem(currentDeckItem.orderItem)
      : null;
  const shelfBusy =
    currentDeckItem && rackVerifiedIds.has(currentDeckItem.orderItem.id)
      ? primaryBusyCodeForOrderItem(currentDeckItem.orderItem)
      : null;
  const shelfQuery = useQuery({
    queryKey: ['pickerShelf', shelfBinId, shelfBusy],
    queryFn: () => fetchBinPickerShelf(shelfBinId!, shelfBusy!),
    enabled: Boolean(shelfBinId && shelfBusy != null),
  });

  const mrpFocusItem = useMemo(() => {
    const focusId = mrpSheetItemId ?? currentDeckItem?.orderItem.id ?? null;
    if (!focusId || !order?.items) return null;
    return order.items.find((i) => i.id === focusId) ?? null;
  }, [currentDeckItem?.orderItem.id, mrpSheetItemId, order?.items]);

  const mrpFocusLookup = useMemo(
    () => (mrpFocusItem ? pickLineMrpLookup(mrpFocusItem) : null),
    [mrpFocusItem],
  );

  const mrpFocusRackVerified =
    mrpFocusItem != null &&
    (rackVerifiedIds.has(mrpFocusItem.id) || mrpSheetItemId === mrpFocusItem.id);

  const { data: mrpHistoryData, isLoading: mrpHistoryLoading } = useStockMrpHistory(
    mrpFocusLookup?.busyCode,
    (mrpFocusItem?.stock_location_code as StockLocationCode | null) ?? null,
    mrpFocusLookup?.itemsMrpFallback ?? null,
    Boolean(mrpFocusItem && mrpFocusRackVerified),
  );

  const updateLineMrp = useCallback((itemId: number, patch: Partial<PickLineMrpState>) => {
    setLineMrpMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(itemId) ?? createDefaultPickLineMrpState();
      next.set(itemId, { ...existing, ...patch });
      return next;
    });
  }, []);

  const setActiveBatchQty = useCallback((itemId: number, qty: number) => {
    setLineMrpMap((prev) => {
      const state = prev.get(itemId);
      if (!state || state.activeSegmentIndex == null) return prev;
      const next = new Map(prev);
      const segments = [...state.segments];
      const idx = state.activeSegmentIndex;
      segments[idx] = { ...segments[idx]!, qty: Math.max(0, Math.floor(qty)) };
      next.set(itemId, { ...state, segments });
      return next;
    });
  }, []);

  const openMrpSheet = useCallback((itemId: number, batchMode = false) => {
    setMrpSheetBatchMode(batchMode);
    setMrpSheetItemId(itemId);
  }, []);

  const closeMrpSheet = useCallback(() => {
    setMrpSheetBatchMode(false);
    setMrpSheetItemId(null);
  }, []);

  const mrpSheetUsesBatchMode = useCallback(
    (itemId: number): boolean => {
      if (mrpSheetBatchMode) return true;
      return isSplitMode(lineMrpMap.get(itemId));
    },
    [lineMrpMap, mrpSheetBatchMode],
  );

  const ensureSplitLineMrp = useCallback(
    (itemId: number, targetQty: number): PickLineMrpState => {
      const existing = lineMrpMap.get(itemId);
      if (isSplitMode(existing)) return existing!;
      return enterSplitMode(existing, itemId, targetQty);
    },
    [lineMrpMap],
  );

  useEffect(() => {
    if (!currentTarget) {
      setPreferredPickLayer(null);
      return;
    }
    setPreferredPickLayer((prev) =>
      prev && prev.orderItemId !== currentTarget.orderItem.id ? null : prev,
    );
  }, [currentTarget?.orderItem.id]);

  /* ─── Mutations ──────────────────────────────────────────── */

  const itemTransitionMutation = useMutation({
    mutationFn: async ({
      transition,
      optimisticState,
    }: {
      transition: PickItemTransition;
      optimisticState?: PickItemUiState;
    }) => {
      const itemId = transition.itemId;
      const previous = localItems.get(itemId) ?? null;
      if (optimisticState) {
        updateLocalItem(itemId, { uiState: optimisticState });
      }
      await transitionAdapter.applyTransition(transition);

      if (isLab || !order || transition.kind !== 'flagged') return { itemId, previous };
      const { reason, notes } = transition;

      if (reason === 'Out of Stock') {
        const target = order.items.find((oi) => oi.id === itemId);
        if (target) {
          const qtyPending = pickQuantityTarget(target);
          if (qtyPending > 0) {
            // Avoid duplicate pending rows for same order+item while status is pending
            const { data: existing, error: existingError } = await supabase
              .from('pending_items')
              .select('id')
              .eq('order_id', order.id)
              .eq('item_id', target.item_id)
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
                item_id: target.item_id,
                item_name: target.item_name,
                qty_pending: qtyPending,
                source: 'picking',
                created_by: userName || 'Picker',
                note: notes || null,
              });
            }
          }
        }
      }

      const flaggedLine = order.items.find((oi) => oi.id === itemId);
      if (flaggedLine) {
        try {
          await sendInternalNotification({
            eventType: 'item_flagged_by_picker',
            orderId: order.id,
            orderNumber: order.order_number,
            customerName: order.customer_name,
            itemName: flaggedLine.item_name,
            flagReason: reason,
            pickerName: userName,
            orderItemId: itemId,
            flagNotes: notes,
            flagBoxPrice: null,
          });
        } catch {
          /* silent */
        }
      }
      return { itemId, previous };
    },
    onError: (_err, vars) => {
      const itemId = vars.transition.itemId;
      const previous = localItems.get(itemId);
      updateLocalItem(itemId, { uiState: previous?.uiState ?? 'pending' });
      if (vars.transition.kind === 'flagged') {
        toast.error('Failed to flag item');
      } else if (vars.transition.kind === 'picked') {
        toast.error('Failed to mark item as picked');
      } else {
        toast.error('Failed to save scan result');
      }
    },
    onSuccess: () => {
      if (!isLab) {
        queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        queryClient.invalidateQueries({ queryKey: [STOCK_MRP_HISTORY_QUERY_KEY] });
      }
    },
  });

  const tryConsumeShelfStock = useCallback(
    async (
      orderItem: OrderItem,
      qtyDelta: number,
      overrideReason?: string | null,
    ): Promise<'ok' | 'override_blocked' | 'abort'> => {
      if (isLab || qtyDelta <= 0) return 'ok';
      const busy = primaryBusyCodeForOrderItem(orderItem);
      if (busy == null) return 'ok';
      const bin = binIdForPickItem(orderItem) ?? STAGING_BIN_DEFAULT;
      const preferredLayerId =
        preferredPickLayer?.orderItemId === orderItem.id ? preferredPickLayer.layerId : null;
      const res = await consumeBinLayerForPick({
        orderItemId: orderItem.id,
        qtyEa: qtyDelta,
        userId,
        binId: bin,
        preferredLayerId,
        overrideReason: overrideReason ?? null,
      });
      if (res.success) {
        void queryClient.invalidateQueries({ queryKey: ['pickerShelf', bin, busy] });
        return 'ok';
      }
      if (res.reason === 'override_reason_required') {
        return 'override_blocked';
      }
      if (res.reason === 'insufficient_layer_stock') {
        toast.warning('Shelf MRP layers short — pick still recorded. Reconcile stock if needed.');
        return 'ok';
      }
      toast.error(res.reason);
      return 'abort';
    },
    [isLab, preferredPickLayer, queryClient, toast, userId],
  );

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
      if (isLab) return;
      const isCompleted = !hasFlagged;
      
      if (claimId && userId) {
        const { error } = await supabase.rpc('complete_picking', {
          p_order_id: order.id,
          p_claim_id: claimId,
          p_user_id: userId,
          p_has_flags: hasFlagged,
        });
        if (error) throw error;
      } else {
        // Fallback for orders without claims
        const updates: {
          workflow_status: 'completed' | 'flagged';
          completed_at?: string;
          priority?: 'normal';
        } = {
          workflow_status: isCompleted ? 'completed' : 'flagged',
        };
        if (!order.completed_at && isCompleted) {
          updates.completed_at = new Date().toISOString();
        }
        if (isCompleted) {
          updates.priority = 'normal';
        }
        const { error } = await supabase
          .from('orders')
          .update(updates)
          .eq('id', order.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      if (isLab) {
        appHaptics.success();
        toast.info('Lab session complete — order unchanged in production.');
        setShowComplete(true);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['picker-daily-stats'] });
      appHaptics.success();
      setShowComplete(true);
    },
    onError: () => {
      toast.error('Failed to complete order');
    },
  });

  const openManualQty = useCallback((orderItem: OrderItem) => {
    appHaptics.selection();
    const lineMrp = lineMrpMap.get(orderItem.id);
    if (isSplitMode(lineMrp) && !getActiveSegment(lineMrp)) {
      toast.info('Choose MRP for this batch first.');
      openMrpSheet(orderItem.id, true);
      return;
    }
    const local = localItems.get(orderItem.id);
    const targetQty = pickQuantityTarget(orderItem);
    const splitRemaining = isSplitMode(lineMrp)
      ? pickLineSplitRemaining(lineMrp, targetQty)
      : null;
    const picked = isSplitMode(lineMrp)
      ? 0
      : Math.min(
          targetQty,
          getPickedQtyFromResult(local?.scanResult ?? orderItem.scan_result),
        );
    const remaining = splitRemaining ?? Math.max(1, targetQty - picked);
    setManualQtyTargetItemId(orderItem.id);
    setManualQtyInitial(remaining);
    setScannerHint(null);
  }, [lineMrpMap, localItems, openMrpSheet, toast]);

  const flagOutOfStock = useCallback(
    (itemId: number) => {
      appHaptics.impactMedium();
      const orderItem = order?.items.find((oi) => oi.id === itemId);
      if (!orderItem) return;
      if (!rackVerifiedIds.has(itemId)) {
        markRackVerified(itemId, 'override');
      }
      const scanResult = mergeMrpIntoScanResult(
        {
          scannedText: 'OUT_OF_STOCK',
          confidence: 100,
          isMatch: false,
          matchedAgainst: orderItem.item_alias ?? String(orderItem.item_id),
          matchStrategy: 'out_of_stock',
          ocrExtracted: { partNumber: null, mrp: null },
          method: 'manual',
          timestamp: new Date().toISOString(),
          reason: 'Picker marked out of stock at pick',
          progress: {
            pickedQty: 0,
            remainingQty: pickQuantityTarget(orderItem),
            targetQty: pickQuantityTarget(orderItem),
          },
        },
        lineMrpMap.get(itemId),
        itemId === mrpFocusItem?.id ? (mrpHistoryData?.latest_mrp ?? null) : null,
        itemId === mrpFocusItem?.id ? (mrpHistoryData?.history.length ?? 0) : 0,
        mrpHistoryData?.source === 'empty' ? null : (mrpHistoryData?.source ?? 'stock_mrpwise'),
      );
      itemTransitionMutation.mutate(
        {
          transition: {
            kind: 'flagged',
            itemId,
            reason: 'Out of Stock',
            notes: null,
            boxPrice: null,
            scanResult,
          },
          optimisticState: 'flagged',
        },
        {
          onSuccess: () => {
            toast.info('Flagged — out of stock');
            beginLineOutcome({
              itemId,
              kind: 'flagged',
              reason: 'Out of Stock',
            });
          },
        },
      );
    },
    [
      itemTransitionMutation,
      lineMrpMap,
      markRackVerified,
      mrpFocusItem?.id,
      mrpHistoryData,
      order?.items,
      rackVerifiedIds,
      beginLineOutcome,
      toast,
    ],
  );

  const engageScanner = useCallback(
    (orderItem: OrderItem, mode: 'rack' | 'item') => {
      appHaptics.impactMedium();
      setEngagedScanner({ itemId: orderItem.id, mode });
      setScannerHint(null);
    },
    [],
  );

  const resolveRevertRestoreQty = useCallback(
    (orderItem: OrderItem, lineMrp?: PickLineMrpState): number | null => {
      if (lineMrp?.originalTargetQty != null) return lineMrp.originalTargetQty;
      const rootId = lineMrp?.rootOrderItemId ?? orderItem.id;
      const siblings =
        order?.items.filter((i) => i.split_from_id === rootId) ?? [];
      if (siblings.length > 0) {
        const merged =
          pickQuantityTarget(orderItem) +
          siblings.reduce((sum, row) => sum + pickQuantityTarget(row), 0);
        return merged > 0 ? merged : null;
      }
      if (isSplitMode(lineMrp) && lineMrp?.segments.some((s) => s.committed)) {
        return lineMrp.originalTargetQty;
      }
      return null;
    },
    [order?.items],
  );

  const executeRevertPick = useCallback(
    async (itemId: number, mode: RevertPickLineMode) => {
      if (!order || !userId) return;
      const orderItem = order.items.find((oi) => oi.id === itemId);
      if (!orderItem) return;

      const lineMrp = lineMrpMap.get(itemId);
      const rootId = lineMrp?.rootOrderItemId ?? itemId;
      const restoreQty =
        mode === 'full'
          ? resolveRevertRestoreQty(orderItem, lineMrp)
          : pickQuantityTarget(orderItem);

      setLineOutcome(null);
      setUndoSnapshot(null);
      setRevertConfirm(null);
      setRevertPickPending(true);

      try {
        if (isLab) {
          updateLocalItem(itemId, { uiState: 'pending', scanResult: null });
          if (mode === 'full') {
            updateLineMrp(itemId, createDefaultPickLineMrpState());
          }
          appHaptics.impactLight();
          toast.info(
            mode === 'full'
              ? 'Line reset — verify MRP and qty again.'
              : 'Qty reset — pick again.',
          );
          return;
        }

        const result = await revertPickLine({
          orderId: order.id,
          claimId,
          userId,
          orderItemId: rootId,
          mode,
          restoreQty,
        });

        if (!result.success) {
          toast.error(result.error ?? 'Could not reset this line. Refresh and try again.');
          return;
        }

        updateLocalItem(itemId, { uiState: 'pending', scanResult: null });
        if (mode === 'full') {
          updateLineMrp(itemId, createDefaultPickLineMrpState());
        }
        await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        appHaptics.impactLight();
        toast.info(
          mode === 'full'
            ? 'Line reset — verify MRP and qty again.'
            : 'Qty reset — pick again.',
        );
      } finally {
        setRevertPickPending(false);
      }
    },
    [
      claimId,
      isLab,
      lineMrpMap,
      order,
      orderId,
      queryClient,
      resolveRevertRestoreQty,
      toast,
      updateLineMrp,
      updateLocalItem,
      userId,
    ],
  );

  const requestRevertPick = useCallback(
    (itemId: number, mode: RevertPickLineMode) => {
      const orderItem = order?.items.find((oi) => oi.id === itemId);
      if (!orderItem) return;
      appHaptics.selection();
      setRevertConfirm({ itemId, mode, itemName: orderItem.item_name });
    },
    [order?.items],
  );

  const revertLastPick = useCallback(async () => {
    const snapshot = undoSnapshot;
    if (!snapshot) return;
    setUndoSnapshot(null);
    setLineOutcome(null);
    if (isLab) {
      updateLocalItem(snapshot.itemId, {
        uiState:
          snapshot.previousState === 'picked'
            ? 'picked'
            : snapshot.previousState === 'flagged'
              ? 'flagged'
              : snapshot.previousScanResult?.isMatch
                ? 'matched'
                : 'pending',
        scanResult: snapshot.previousScanResult,
      });
      appHaptics.impactLight();
      toast.info(`Undid ${snapshot.itemName}. Pick it again or skip.`);
      return;
    }
    try {
      const { error } = await supabase
        .from('order_items')
        .update({
          state: snapshot.previousState,
          scan_result: (snapshot.previousScanResult ?? null) as unknown as Record<string, unknown> | null,
        })
        .eq('id', snapshot.itemId);
      if (error) throw error;
      updateLocalItem(snapshot.itemId, {
        uiState:
          snapshot.previousState === 'picked'
            ? 'picked'
            : snapshot.previousState === 'flagged'
              ? 'flagged'
              : snapshot.previousScanResult?.isMatch
                ? 'matched'
                : 'pending',
        scanResult: snapshot.previousScanResult,
      });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      appHaptics.impactLight();
      toast.info(`Undid ${snapshot.itemName}. Pick it again or skip.`);
    } catch {
      toast.error('Could not undo. Refresh and try again.');
    }
  }, [isLab, orderId, queryClient, toast, undoSnapshot, updateLocalItem]);

  const processEmbeddedScan = useCallback(
    (orderItem: OrderItem, mode: 'rack' | 'item', scan: LiveQrScannerResolved) => {
      const now = Date.now();
      if (
        lastScanMeta &&
        lastScanMeta.rawValue === scan.rawValue &&
        now - lastScanMeta.at < DUPLICATE_SCAN_WINDOW_MS
      ) {
        setScannerHint('Duplicate scan ignored. Keep moving to the next label.');
        return;
      }
      setLastScanMeta({ rawValue: scan.rawValue, at: now });

      const local = localItems.get(orderItem.id);
      const previousScanResult = local?.scanResult ?? orderItem.scan_result;

      if (mode === 'rack') {
        const classified = classifyScanPayload(scan.rawValue);
        const expectedRack = orderItem.rack_no;
        const stagingOnly = orderItemUsesStagingOnly(orderItem);

        let gateOk = false;
        if (stagingOnly && scan.matchesPickItem) {
          gateOk = true;
        } else if (classified.kind === 'rack' && classified.rackPayload) {
          const scannedCode = classified.rackPayload.rackCode;
          if (stagingOnly && rackCodesMatch(scannedCode, STAGING_BIN_DEFAULT)) {
            gateOk = true;
          } else if (!stagingOnly && expectedRack && !rackCodesMatch(scannedCode, expectedRack)) {
            setScannerHint(
              `Wrong shelf — scanned ${scannedCode}, expected ${expectedRack ?? '—'}. Walk to the right rack.`,
            );
            appHaptics.warning();
            return;
          } else {
            gateOk = true;
          }
        } else if (scan.matchesPickItem) {
          gateOk = true;
        } else if (
          expectedRack &&
          classified.normalizedCandidates.some((c) => rackCodesMatch(c, expectedRack))
        ) {
          gateOk = true;
        }

        if (!gateOk) {
          setScannerHint(
            stagingOnly
              ? 'Scan the carton: PASPL-PACK inner or ITEM alias on the label (stock may be in STAGING).'
              : expectedRack
                ? 'Scan the bin license plate: ITEM or pack QR for this product, or a location QR that matches this rack.'
                : 'Scan the bin license plate (ITEM or pack QR) for this line.',
          );
          appHaptics.warning();
          return;
        }

        markRackVerified(orderItem.id, 'scan');
        setEngagedScanner({ itemId: orderItem.id, mode: 'item' });
        setScannerHint(null);
        return;
      }

      const targetQty = pickQuantityTarget(orderItem);
      if (targetQty <= 0) {
        const zeroQtyResult: ScanResult = {
          isMatch: false,
          confidence: 0,
          extractedCode: scan.lookupCode ?? undefined,
          extractedDescription: scan.matchedItem?.name ?? undefined,
          reason: 'Line has 0 target qty. Manual qty entry or flag is required.',
          scannedText: scan.rawValue,
          matchedAgainst: scan.matchedBy ?? orderItem.item_name,
          matchStrategy: 'zero_target_guard',
          ocrExtracted: {
            partNumber: scan.lookupCode ?? null,
            mrp: null,
          },
          method: 'qr_scan',
          timestamp: new Date().toISOString(),
          codeType: classifyScanPayload(scan.rawValue).kind,
          suggestedQty: 0,
          requiresBreakConfirmation: false,
          operatorContext: {
            pickerName: userName,
            pickerUserId: userId,
            source: 'scanner',
          },
        };
        updateLocalItem(orderItem.id, {
          uiState: 'warning',
          scanResult: zeroQtyResult,
        });
        itemTransitionMutation.mutate({
          transition: {
            kind: 'scan_saved',
            itemId: orderItem.id,
            scanResult: zeroQtyResult,
          },
        });
        appHaptics.warning();
        setScannerHint('This line has target qty 0. Enter qty manually or flag it. It will not auto-skip.');
        return;
      }

      const classified = classifyScanPayload(scan.rawValue);
      const lookupCandidates = classified.normalizedCandidates;
      const packPayload = parsePackPickPayload(scan.rawValue);
      const lpnPayload = parseLpnPickPayload(scan.rawValue);
      const busyCodeCandidates = deriveBusyCodeCandidates(orderItem);
      const packDefinitionByPayload = packPayload
        ? packDefinitionByBusyCode.get(packPayload.busyCode) ?? null
        : null;
      const packDefinitionByCurrentItem = packDefinitionByItemId.get(orderItem.item_id) ?? null;
      const payloadMatchesCurrentItem = Boolean(
        packPayload &&
          (
            busyCodeCandidates.includes(packPayload.busyCode) ||
            (packDefinitionByPayload?.item_id_snapshot != null &&
              packDefinitionByPayload.item_id_snapshot === orderItem.item_id) ||
            (packDefinitionByCurrentItem != null &&
              packDefinitionByCurrentItem.busy_code === packPayload.busyCode)
          ),
      );
      const matchedBusyCode =
        packPayload && payloadMatchesCurrentItem ? packPayload.busyCode : null;
      const packDefinition = packDefinitionByPayload;
      const packQty =
        packPayload?.packType === 'inner'
          ? packDefinition?.inner_pack_qty ?? null
          : packPayload?.packType === 'outer'
            ? packDefinition?.outer_pack_qty ?? null
            : null;
      const lpnSuggested = lpnPayload?.remainingQty ?? null;
      const existingPickedBefore = Math.min(
        targetQty,
        getPickedQtyFromResult(previousScanResult),
      );
      const remainingBeforeScan = Math.max(0, targetQty - existingPickedBefore);
      const suggestedQty =
        scan.baseQtyEa != null && scan.baseQtyEa >= 1
          ? Math.floor(scan.baseQtyEa)
          : classified.kind === 'lpn' && Number.isFinite(lpnSuggested)
            ? Math.max(1, Number(lpnSuggested))
            : Number.isFinite(packQty) && (packQty ?? 0) > 0
              ? Number(packQty)
              : classified.extractedQuantity && classified.extractedQuantity > 0
                ? classified.extractedQuantity
                : 1;
      const uomHint = formatUomPickHint({
        suggestedQtyEa: suggestedQty,
        tier: scan.uomTier,
        packetQtyEa: scan.packetQtyEa,
        packetsPerBox: scan.packetsPerBox,
        packPayloadType: packPayload?.packType ?? null,
      });
      const requiresBreakConfirmation = suggestedQty > remainingBeforeScan;
      const requiresLargeQtyConfirmation =
        suggestedQty > MAX_AUTO_SCAN_QTY && remainingBeforeScan > 1;
      const requiresManualQtyConfirmation =
        requiresBreakConfirmation || requiresLargeQtyConfirmation;
      const isPackMatch = Boolean(packPayload && matchedBusyCode);
      const isMatch = scan.matchesPickItem || isPackMatch;
      const matchStrategy = isPackMatch
        ? 'pack_qr_match'
        : scan.matchesPickItem
          ? 'qr_catalog_hit'
          : scan.matchedItem
            ? 'qr_expected_mismatch'
            : 'qr_catalog_miss';

      const result: ScanResult = {
        isMatch,
        confidence: isMatch ? 100 : 0,
        extractedCode: scan.lookupCode ?? lookupCandidates[0],
        extractedDescription: scan.matchedItem?.name ?? undefined,
        reason: isPackMatch
          ? requiresBreakConfirmation
            ? `${uomHint ? `${uomHint}. ` : ''}Pack scan (${packPayload?.packType}) suggests ${suggestedQty} units. Confirm break-pack for target ${targetQty}.`
            : `${uomHint ? `${uomHint}. ` : ''}Pack scan (${packPayload?.packType}) verified for ${suggestedQty} units.`
          : classified.kind === 'lpn'
            ? `${uomHint ? `${uomHint}. ` : ''}LPN scan ${lpnPayload?.lpnCode ?? ''} suggests ${suggestedQty} units.`
            : scan.reason,
        scannedText: scan.rawValue,
        matchedAgainst: scan.matchedBy ?? orderItem.item_name,
        matchStrategy,
        ocrExtracted: {
          partNumber: scan.lookupCode ?? null,
          mrp: null,
        },
        method: 'qr_scan',
        timestamp: new Date().toISOString(),
        codeType: classified.kind,
        suggestedQty,
        requiresBreakConfirmation: requiresManualQtyConfirmation,
        lpnCode: lpnPayload?.lpnCode ?? null,
        uomHint,
        uomContext: {
          tier: scan.uomTier,
          packetQtyEa: scan.packetQtyEa,
          packetsPerBox: scan.packetsPerBox,
        },
        packAssist: isPackMatch
          ? {
              packType: packPayload!.packType,
              packQty: suggestedQty,
              suggestedQty,
              requiresBreakConfirmation: requiresManualQtyConfirmation,
              busyCode: matchedBusyCode!,
            }
          : undefined,
        operatorContext: {
          pickerName: userName,
          pickerUserId: userId,
          source: 'scanner',
        },
      };

      const uiState: PickItemUiState = result.isMatch ? 'matched' : 'error';

      updateLocalItem(orderItem.id, {
        uiState,
        scanResult: result,
      });

      if (!result.isMatch || requiresManualQtyConfirmation) {
        itemTransitionMutation.mutate({
          transition: {
            kind: 'scan_saved',
            itemId: orderItem.id,
            scanResult: result,
          },
        });
      }

      if (requiresManualQtyConfirmation) {
        setPendingPackConfirmation({
          orderItemId: orderItem.id,
          scanResult: result,
          suggestedQty,
          targetQty: remainingBeforeScan,
        });
      }

      if (result.isMatch && !requiresManualQtyConfirmation) {
        const nextPicked = Math.min(targetQty, existingPickedBefore + suggestedQty);
        const nextRemaining = Math.max(0, targetQty - nextPicked);
        const delta = nextPicked - existingPickedBefore;
        const progressedResult: ScanResult = {
          ...result,
          progress: {
            pickedQty: nextPicked,
            remainingQty: nextRemaining,
            targetQty,
          },
        };
        void (async () => {
          const inv = await tryConsumeShelfStock(orderItem, delta);
          if (inv === 'override_blocked') {
            setFifoOverrideSheet({
              orderItemId: orderItem.id,
              qtyDelta: delta,
              qtyToApply: suggestedQty,
              resume: 'scan',
              scanFinalize: {
                progressedResult,
                nextRemaining,
                previousScanResult,
                suggestedLabel: orderItem.item_name,
                classifiedKind: classified.kind,
              },
            });
            return;
          }
          if (inv === 'abort') return;
          updateLocalItem(orderItem.id, {
            scanResult: progressedResult,
            uiState: nextRemaining === 0 ? 'picked' : 'matched',
          });
          itemTransitionMutation.mutate({
            transition: {
              kind: 'scan_saved',
              itemId: orderItem.id,
              scanResult: progressedResult,
            },
          });
          if (nextRemaining === 0) {
            itemTransitionMutation.mutate({
              transition: {
                kind: 'picked',
                itemId: orderItem.id,
                scanResult: progressedResult,
              },
              optimisticState: 'picked',
            });
            setUndoSnapshot({
              itemId: orderItem.id,
              itemName: orderItem.item_name,
              itemCode: orderItem.item_alias ?? null,
              previousScanResult,
              previousState: 'pending',
              expiresAt: Date.now() + UNDO_DURATION_MS,
            });
            beginLineOutcome({
              itemId: orderItem.id,
              kind: resolvePickOutcomeKind(targetQty, targetQty),
              pickedQty: targetQty,
            });
            appHaptics.success();
          }
          setScannerHint(
            nextRemaining === 0
              ? `Completed ${orderItem.item_name}.`
              : `Matched ${classified.kind.toUpperCase()} scan. ${nextRemaining} remaining.`,
          );
        })();
      } else {
        appHaptics.warning();
      }
    },
    [
      lastScanMeta,
      itemTransitionMutation,
      localItems,
      markRackVerified,
      packDefinitionByBusyCode,
      packDefinitionByItemId,
      beginLineOutcome,
      tryConsumeShelfStock,
      updateLocalItem,
      userId,
      userName,
    ],
  );

  const makeEmbeddedScanHandler = useCallback(
    (orderItem: OrderItem, mode: 'rack' | 'item') => (scan: LiveQrScannerResolved) => {
      processEmbeddedScan(orderItem, mode, scan);
    },
    [processEmbeddedScan],
  );

  const applyPickedQty = useCallback(
    async (
      itemId: number,
      qtyToApply: number,
      opts?: {
        skipInventory?: boolean;
        overrideReason?: string | null;
        verifiedProductCode?: string;
      },
    ) => {
      if (!Number.isFinite(qtyToApply) || qtyToApply <= 0) return;
      appHaptics.impactMedium();
      const local = localItems.get(itemId);
      const orderItem = order?.items.find((oi) => oi.id === itemId);
      if (!orderItem) return;
      const targetQty = pickQuantityTarget(orderItem);
      if (targetQty <= 0) {
        toast.error('Cannot auto-apply on a 0 qty line. Use Enter qty or flag this line.');
        return;
      }
      const previousScanResult = local?.scanResult ?? orderItem.scan_result;
      const previousState: OrderItemState = orderItem.state;
      const existingPicked = Math.min(
        targetQty,
        getPickedQtyFromResult(previousScanResult),
      );
      const nextPicked = Math.min(targetQty, existingPicked + Math.floor(qtyToApply));
      const nextRemaining = Math.max(0, targetQty - nextPicked);
      const delta = nextPicked - existingPicked;

      if (!opts?.skipInventory && delta > 0) {
        const inv = await tryConsumeShelfStock(orderItem, delta, opts?.overrideReason ?? null);
        if (inv === 'override_blocked') {
          setFifoOverrideSheet({
            orderItemId: itemId,
            qtyDelta: delta,
            qtyToApply: Math.floor(qtyToApply),
            resume: 'manual',
          });
          return;
        }
        if (inv === 'abort') return;
      }

      const verifiedCode = opts?.verifiedProductCode?.trim() ?? '';
      const manualScanResult: ScanResult = local?.scanResult ?? {
        scannedText: verifiedCode || 'MANUAL_PICK',
        confidence: verifiedCode ? 100 : 100,
        isMatch: true,
        matchedAgainst: verifiedCode || 'manual',
        matchStrategy: verifiedCode ? 'manual_code_verify' : 'manual_pick',
        ocrExtracted: { partNumber: verifiedCode || null, mrp: null },
        method: 'manual',
        timestamp: new Date().toISOString(),
        reason: verifiedCode
          ? 'Product code verified manually (barcode unreadable)'
          : 'Manual pick confirmation',
        extractedCode: verifiedCode || undefined,
        operatorContext: {
          pickerName: userName,
          pickerUserId: userId,
          source: 'manual',
        },
      };
      const progressedResult: ScanResult = mergeMrpIntoScanResult(
        {
          ...manualScanResult,
          suggestedQty: Math.floor(qtyToApply),
          progress: {
            pickedQty: nextPicked,
            remainingQty: nextRemaining,
            targetQty,
          },
        },
        lineMrpMap.get(itemId),
        itemId === mrpFocusItem?.id ? (mrpHistoryData?.latest_mrp ?? null) : null,
        itemId === mrpFocusItem?.id ? (mrpHistoryData?.history.length ?? 0) : 0,
        mrpHistoryData?.source === 'empty' ? null : (mrpHistoryData?.source ?? 'stock_mrpwise'),
      );
      itemTransitionMutation.mutate({
        transition: {
          kind: 'scan_saved',
          itemId,
          scanResult: progressedResult,
        },
      });
      updateLocalItem(itemId, {
        scanResult: progressedResult,
        uiState: nextRemaining === 0 ? 'picked' : 'matched',
      });
      if (nextRemaining === 0) {
        itemTransitionMutation.mutate({
          transition: {
            kind: 'picked',
            itemId,
            scanResult: progressedResult,
          },
          optimisticState: 'picked',
        });
        setUndoSnapshot({
          itemId,
          itemName: orderItem.item_name,
          itemCode: orderItem.item_alias ?? null,
          previousScanResult,
          previousState,
          expiresAt: Date.now() + UNDO_DURATION_MS,
        });
        beginLineOutcome({
          itemId,
          kind: resolvePickOutcomeKind(nextPicked, targetQty),
          pickedQty: nextPicked,
        });
        appHaptics.success();
      }
    },
    [
      itemTransitionMutation,
      localItems,
      order?.items,
      beginLineOutcome,
      toast,
      tryConsumeShelfStock,
      updateLocalItem,
      userId,
      userName,
      lineMrpMap,
      mrpFocusItem?.id,
      mrpHistoryData,
    ],
  );

  const handleMarkPicked = useCallback(
    (orderItem: OrderItem) => {
      const itemId = orderItem.id;
      if (!rackVerifiedIds.has(itemId)) {
        markRackVerified(itemId, 'override');
      }
      const targetQty = pickQuantityTarget(orderItem);
      const local = localItems.get(itemId);
      const pickedQty = Math.min(
        targetQty,
        getPickedQtyFromResult(local?.scanResult ?? orderItem.scan_result),
      );
      const remaining = Math.max(0, targetQty - pickedQty);
      if (remaining <= 0) {
        toast.info('Qty already complete for this line.');
        return;
      }
      void applyPickedQty(itemId, remaining);
    },
    [applyPickedQty, localItems, markRackVerified, rackVerifiedIds, toast],
  );

  const applySegmentPick = useCallback(
    async (itemId: number, segmentQty: number) => {
      if (!order || !userId) return;
      const orderItem = order.items.find((oi) => oi.id === itemId);
      if (!orderItem) return;

      const lineMrp = lineMrpMap.get(itemId);
      const active = getActiveSegment(lineMrp);
      if (!lineMrp || !active || segmentQty <= 0) return;

      const rootId = lineMrp.rootOrderItemId ?? itemId;
      const goal = lineMrp.originalTargetQty ?? pickQuantityTarget(orderItem);
      const remaining = pickLineSplitRemaining(lineMrp, pickQuantityTarget(orderItem));
      const qty = Math.min(segmentQty, remaining);
      if (qty <= 0) {
        toast.error('No qty left on this line.');
        return;
      }

      const isFirstSegment = lineMrp.segments.filter((s) => s.committed).length === 0;

      if (!rackVerifiedIds.has(itemId)) {
        markRackVerified(itemId, 'override');
      }

      const inv = await tryConsumeShelfStock(orderItem, qty);
      if (inv === 'override_blocked') {
        setFifoOverrideSheet({
          orderItemId: itemId,
          qtyDelta: qty,
          qtyToApply: qty,
          resume: 'manual',
        });
        return;
      }
      if (inv === 'abort') return;

      const segmentMrp = active.mrp;
      const latestMrp = mrpHistoryData?.latest_mrp ?? null;
      const historyCount = mrpHistoryData?.history.length ?? 0;
      const mrpSource =
        mrpHistoryData?.source === 'empty' ? null : (mrpHistoryData?.source ?? 'stock_mrpwise');

      const committedCount = pickLineSegmentsCommittedQty(lineMrp) + qty;
      const scanResult = mergeMrpIntoScanResult(
        {
          scannedText: 'MRP_SPLIT_BATCH',
          confidence: 100,
          isMatch: true,
          matchedAgainst: orderItem.item_alias ?? String(orderItem.item_id),
          matchStrategy: 'mrp_split_batch',
          ocrExtracted: { partNumber: null, mrp: segmentMrp },
          method: 'manual',
          timestamp: new Date().toISOString(),
          reason: `MRP split batch · ₹${Math.round(segmentMrp)} × ${qty}`,
          progress: {
            pickedQty: committedCount,
            remainingQty: Math.max(0, goal - committedCount),
            targetQty: goal,
          },
          operatorContext: {
            pickerName: userName,
            pickerUserId: userId,
            source: 'manual',
          },
        },
        lineMrp,
        latestMrp,
        historyCount,
        mrpSource,
        segmentMrp,
      );

      let orderItemId = rootId;
      if (isLab) {
        orderItemId = rootId;
        updateLineMrp(itemId, commitActiveSegment(lineMrp, qty, orderItemId));
      } else {
        const rpcResult = await commitPickMrpSegment({
          orderId: order.id,
          claimId,
          userId,
          rootOrderItemId: rootId,
          segmentQty: qty,
          confirmedMrp: segmentMrp,
          scanResult,
          isFirstSegment,
        });

        if (!rpcResult.success) {
          toast.error(rpcResult.error ?? 'Failed to save MRP batch');
          return;
        }

        orderItemId = rpcResult.order_item_id ?? rootId;
        updateLineMrp(itemId, commitActiveSegment(lineMrp, qty, orderItemId));
        await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      }

      const nextRemaining = Math.max(0, goal - committedCount);
      appHaptics.success();

      if (nextRemaining === 0) {
        const batchCount = lineMrp.segments.filter((s) => s.committed).length + 1;
        updateLocalItem(itemId, { uiState: 'picked', scanResult });
        beginLineOutcome({
          itemId,
          kind: 'picked',
          pickedQty: goal,
        });
        toast.success(
          batchCount > 1
            ? `${goal} pcs · ${batchCount} MRP batches — billing will see ${batchCount} lines`
            : `${goal} pcs picked`,
        );
      } else {
        updateLocalItem(itemId, { uiState: 'matched', scanResult });
        toast.info(`Batch saved · ${nextRemaining} pcs left`);
      }
    },
    [
      beginLineOutcome,
      claimId,
      isLab,
      lineMrpMap,
      markRackVerified,
      mrpHistoryData,
      order,
      orderId,
      queryClient,
      rackVerifiedIds,
      toast,
      tryConsumeShelfStock,
      updateLineMrp,
      updateLocalItem,
      userId,
      userName,
    ],
  );

  const handlePickFirstBatch = useCallback(
    (orderItem: OrderItem) => {
      const targetQty = pickQuantityTarget(orderItem);
      updateLineMrp(
        orderItem.id,
        enterSplitMode(lineMrpMap.get(orderItem.id), orderItem.id, targetQty),
      );
      openMrpSheet(orderItem.id, true);
    },
    [lineMrpMap, openMrpSheet, updateLineMrp],
  );

  const handlePickNextMrp = useCallback(
    (orderItem: OrderItem) => {
      openMrpSheet(orderItem.id, true);
    },
    [openMrpSheet],
  );

  const handleAllSameMrp = useCallback(
    (orderItem: OrderItem) => {
      updateLineMrp(orderItem.id, enterSingleModeFromSplit(lineMrpMap.get(orderItem.id)));
      openMrpSheet(orderItem.id, false);
    },
    [lineMrpMap, openMrpSheet, updateLineMrp],
  );

  const handleConfirmBatch = useCallback(
    (orderItem: OrderItem) => {
      const active = getActiveSegment(lineMrpMap.get(orderItem.id));
      if (!active || active.qty <= 0) {
        toast.error('Enter qty for this batch first.');
        return;
      }
      void applySegmentPick(orderItem.id, active.qty);
    },
    [applySegmentPick, lineMrpMap, toast],
  );

  const handleFinishShortSplit = useCallback(
    (orderItem: OrderItem) => {
      const lineMrp = lineMrpMap.get(orderItem.id);
      const committed = pickLineSegmentsCommittedQty(lineMrp);
      if (committed <= 0) {
        toast.error('Pick at least one batch before finishing short.');
        return;
      }
      beginLineOutcome({
        itemId: orderItem.id,
        kind: 'partial',
        pickedQty: committed,
      });
    },
    [beginLineOutcome, lineMrpMap, toast],
  );

  const handleUndoLastSegment = useCallback(
    async (orderItem: OrderItem) => {
      if (!order || !userId) return;
      const lineMrp = lineMrpMap.get(orderItem.id);
      if (!lineMrp) return;
      const committed = lineMrp.segments.filter((s) => s.committed);
      const last = committed[committed.length - 1];
      if (!last?.orderItemId) return;

      const rootId = lineMrp.rootOrderItemId ?? orderItem.id;
      const restoreQty =
        committed.length === 1 && last.orderItemId === rootId
          ? lineMrp.originalTargetQty ?? pickQuantityTarget(orderItem)
          : null;
      if (!isLab) {
        const result = await undoPickMrpSegment({
          orderId: order.id,
          claimId,
          userId,
          rootOrderItemId: rootId,
          segmentOrderItemId: last.orderItemId,
          restoreQty,
        });

        if (!result.success) {
          toast.error(result.error ?? 'Could not undo batch');
          return;
        }
      }

      const nextSegments = lineMrp.segments.slice(0, -1);
      updateLineMrp(orderItem.id, {
        ...lineMrp,
        segments: nextSegments,
        activeSegmentIndex: null,
      });
      updateLocalItem(orderItem.id, { uiState: 'pending', scanResult: null });
      if (!isLab) {
        await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      }
      appHaptics.impactLight();
      toast.info('Last batch undone');
    },
    [claimId, isLab, lineMrpMap, order, orderId, queryClient, toast, updateLineMrp, updateLocalItem, userId],
  );

  const completeQueueItem = useCallback(
    (itemId: number) => {
      const orderItem = order?.items.find((oi) => oi.id === itemId);
      if (!orderItem) return;
      const targetQty = pickQuantityTarget(orderItem);
      const local = localItems.get(itemId);
      const existingPicked = Math.min(
        targetQty,
        getPickedQtyFromResult(local?.scanResult ?? orderItem.scan_result),
      );
      const remaining = Math.max(0, targetQty - existingPicked);
      if (remaining <= 0) return;
      if (!rackVerifiedIds.has(itemId)) {
        markRackVerified(itemId, 'override');
      }
      void applyPickedQty(itemId, remaining);
    },
    [applyPickedQty, localItems, markRackVerified, order?.items, rackVerifiedIds],
  );

  const confirmFifoOverride = useCallback(async () => {
    const sheet = fifoOverrideSheet;
    if (!sheet || fifoOverrideReason.trim().length < 3) {
      toast.error('Enter a reason (at least 3 characters).');
      return;
    }
    const orderItem = order?.items.find((i) => i.id === sheet.orderItemId);
    if (!orderItem) return;
    if (!isLab) {
      const inv = await consumeBinLayerForPick({
        orderItemId: sheet.orderItemId,
        qtyEa: sheet.qtyDelta,
        userId,
        binId: binIdForPickItem(orderItem),
        preferredLayerId:
          preferredPickLayer?.orderItemId === sheet.orderItemId ? preferredPickLayer.layerId : null,
        overrideReason: fifoOverrideReason.trim(),
      });
      if (!inv.success) {
        toast.error(inv.reason);
        return;
      }
      const b = binIdForPickItem(orderItem);
      const busy = primaryBusyCodeForOrderItem(orderItem);
      if (b && busy != null) {
        void queryClient.invalidateQueries({ queryKey: ['pickerShelf', b, busy] });
      }
    }
    const reasonSnap = fifoOverrideReason.trim();
    setFifoOverrideSheet(null);
    setFifoOverrideReason('');
    if (sheet.resume === 'manual') {
      await applyPickedQty(sheet.orderItemId, sheet.qtyToApply, { skipInventory: true, overrideReason: reasonSnap });
    } else if (sheet.scanFinalize) {
      const { progressedResult, nextRemaining, previousScanResult } = sheet.scanFinalize;
      updateLocalItem(sheet.orderItemId, {
        scanResult: progressedResult,
        uiState: nextRemaining === 0 ? 'picked' : 'matched',
      });
      itemTransitionMutation.mutate({
        transition: { kind: 'scan_saved', itemId: sheet.orderItemId, scanResult: progressedResult },
      });
      if (nextRemaining === 0) {
        itemTransitionMutation.mutate({
          transition: { kind: 'picked', itemId: sheet.orderItemId, scanResult: progressedResult },
          optimisticState: 'picked',
        });
        setUndoSnapshot({
          itemId: sheet.orderItemId,
          itemName: orderItem.item_name,
          itemCode: orderItem.item_alias ?? null,
          previousScanResult,
          previousState: 'pending',
          expiresAt: Date.now() + UNDO_DURATION_MS,
        });
        beginLineOutcome({
          itemId: sheet.orderItemId,
          kind: resolvePickOutcomeKind(pickQuantityTarget(orderItem), pickQuantityTarget(orderItem)),
          pickedQty: pickQuantityTarget(orderItem),
        });
      }
      appHaptics.success();
    }
  }, [
    applyPickedQty,
    beginLineOutcome,
    fifoOverrideReason,
    fifoOverrideSheet,
    itemTransitionMutation,
    order?.items,
    preferredPickLayer,
    queryClient,
    toast,
    updateLocalItem,
    userId,
    isLab,
  ]);

  const handleFlagSubmit = useCallback(
    (payload: FlagSubmitPayload) => {
      if (flagTargetItemId === null) return;
      appHaptics.impactMedium();
      itemTransitionMutation.mutate(
        {
          transition: {
            kind: 'flagged',
            itemId: flagTargetItemId,
            reason: payload.reason,
            notes: payload.notes,
            boxPrice: null,
            scanResult: localItems.get(flagTargetItemId)?.scanResult ?? null,
          },
          optimisticState: 'flagged',
        },
        {
          onSuccess: () => {
            toast.info(isLab ? 'Flag recorded (lab only — not sent to billing)' : 'Flag sent to billing');
            setFlagSheetOpen(false);
            beginLineOutcome({
              itemId: flagTargetItemId,
              kind: 'flagged',
              reason: payload.reason,
            });
            setFlagTargetItemId(null);
          },
        },
      );
    },
    [beginLineOutcome, flagTargetItemId, isLab, itemTransitionMutation, localItems, toast],
  );

  // These derived values depend only on hook-provided state, so they must stay
  // above all early returns to satisfy the Rules of Hooks (hook call count must
  // be identical on every render regardless of which early return fires).
  const manualQtyOrderItem = useMemo(() => {
    if (manualQtyTargetItemId == null || !order?.items) return null;
    return order.items.find((oi) => oi.id === manualQtyTargetItemId) ?? null;
  }, [manualQtyTargetItemId, order?.items]);

  const manualQtyPicked = useMemo(() => {
    if (!manualQtyOrderItem) return 0;
    const lineMrp = lineMrpMap.get(manualQtyOrderItem.id);
    if (isSplitMode(lineMrp)) {
      return pickLineSegmentsCommittedQty(lineMrp);
    }
    const target = pickQuantityTarget(manualQtyOrderItem);
    return Math.min(
      target,
      getPickedQtyFromResult(
        localItems.get(manualQtyOrderItem.id)?.scanResult ?? manualQtyOrderItem.scan_result,
      ),
    );
  }, [lineMrpMap, localItems, manualQtyOrderItem]);

  const manualQtyLineRemaining = useMemo(() => {
    if (!manualQtyOrderItem) return 0;
    const target = pickQuantityTarget(manualQtyOrderItem);
    const lineMrp = lineMrpMap.get(manualQtyOrderItem.id);
    if (isSplitMode(lineMrp)) {
      return pickLineSplitRemaining(lineMrp, target);
    }
    return Math.max(0, target - manualQtyPicked);
  }, [lineMrpMap, manualQtyOrderItem, manualQtyPicked]);

  const manualQtySegmentMrp = useMemo(() => {
    if (!manualQtyOrderItem) return null;
    return getActiveSegment(lineMrpMap.get(manualQtyOrderItem.id))?.mrp ?? null;
  }, [lineMrpMap, manualQtyOrderItem]);


  const deckDotStatus = useMemo((): SwipeDeckDotStatus[] => {
    return deckItems.map((pi, index) => {
      if (index === safeCardIndex) return 'active';
      if (pi.uiState === 'flagged') return 'flagged';
      if (pi.uiState === 'picked' || pi.uiState === 'overridden') return 'done';
      const targetQty = pickQuantityTarget(pi.orderItem);
      const pickedQty = Math.min(targetQty, getPickedQtyFromResult(pi.scanResult));
      if (pickedQty > 0 && pickedQty < targetQty) return 'partial';
      return 'pending';
    });
  }, [deckItems, safeCardIndex]);

  const pickStatusRows = useMemo((): PickLineStatusRow[] => {
    return deckItems.map((pi) => {
      const isCurrent = currentDeckItem?.orderItem.id === pi.orderItem.id;
      const targetQty = pickQuantityTarget(pi.orderItem);
      const pickedQty = Math.min(targetQty, getPickedQtyFromResult(pi.scanResult));
      const status = resolvePickLineStatus({
        isCurrent,
        uiState: pi.uiState,
        pickedQty,
        targetQty,
        isSkipped: skippedIds.has(pi.orderItem.id),
        lineClosure:
          lineOutcome?.itemId === pi.orderItem.id ? lineOutcome.kind : null,
      });

      return {
        itemId: pi.orderItem.id,
        code:
          pi.orderItem.catalog_alias1 ??
          pi.orderItem.catalog_alias ??
          pi.orderItem.item_alias ??
          String(pi.orderItem.item_id),
        rackNo: pi.orderItem.rack_no,
        itemName: pi.orderItem.item_name,
        targetQty,
        pickedQty,
        status,
        flagReason: pi.orderItem.flag_reason,
        brandLabel: orderItemBrandLabel(pi.orderItem),
        rackVerified: rackVerifiedIds.has(pi.orderItem.id),
        awaitingAdvance:
          lineOutcome?.itemId === pi.orderItem.id &&
          (lineOutcome.kind === 'picked' ||
            lineOutcome.kind === 'partial' ||
            lineOutcome.kind === 'flagged'),
      };
    });
  }, [currentDeckItem?.orderItem.id, deckItems, lineOutcome, rackVerifiedIds, skippedIds]);

  const pickProgressPct =
    counts.total > 0 ? ((counts.picked + counts.flagged) / counts.total) * 100 : 0;

  if (showComplete && order) {
    return (
      <PickCompleteScreen
        orderNumber={order.order_number}
        customerName={order.customer_name}
        customerCity={order.customer_city}
        transportName={order.transport_name}
        pickedLineCount={counts.picked}
        flaggedLineCount={counts.flagged}
        totalLineCount={counts.total}
        pickedPieceCount={pieceTotals.picked}
        totalPieceCount={pieceTotals.target}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen pb-32">
        <div className="p-4 space-y-4">
          <Skeleton variant="text" lines={2} />
          <Skeleton variant="card" count={5} />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen pb-32 p-4 text-center">
        <p className="text-[var(--content-negative)]">Failed to load order</p>
        <BigButton
          variant="secondary"
          onClick={onBack}
          className="mt-4"
        >
          Back to Queue
        </BigButton>
      </div>
    );
  }

  if (claimError) {
    return (
      <div className="min-h-screen pb-32 p-4">
        <div className="mb-6 p-4 rounded-xl bg-[var(--bg-negative-subtle)] border-2 border-[var(--border-negative)] flex items-start gap-3">
          <Warning size={24} className="text-[var(--content-negative)] mt-0.5 shrink-0" weight="fill" />
          <div>
            <h3 className="font-bold text-[var(--content-negative)]">Cannot pick this order</h3>
            <p className="text-[var(--content-negative)] text-sm mt-1 opacity-90">{claimError}</p>
            <button 
              onClick={onBack}
              className="mt-3 px-4 py-2 bg-[var(--bg-negative)] text-white rounded-lg text-sm font-medium hover:bg-red-600 transition-colors"
            >
              Go back to queue
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (orderItems && orderItems.length === 0) {
    return (
      <div className="min-h-screen pb-32 p-4">
        <div className="mb-6 p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
          <p className="font-semibold text-[var(--content-primary)]">Nothing to pick</p>
          <p className="text-sm text-[var(--content-secondary)] mt-2">
            Billing approved this order with no shippable stock — all lines are on purchase order.
            Return to the queue and pick another order.
          </p>
          <BigButton variant="secondary" onClick={onBack} className="mt-4">
            Back to Queue
          </BigButton>
        </div>
      </div>
    );
  }

  const scannerPaused =
    flagSheetOpen ||
    queueSheetOpen ||
    completeSheetOpen ||
    manualQtyTargetItemId !== null ||
    pendingPackConfirmation !== null ||
    fifoOverrideSheet !== null ||
    mrpSheetItemId !== null ||
    lineOutcome !== null;

  return (
    <div className="role-picking pick-page-shell flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-[var(--bg-primary)]">
      {isLab && (
        <div className="z-50 flex shrink-0 items-center gap-2 border-b border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] px-3 py-2 text-xs font-semibold text-[var(--content-accent)]">
          <Flask size={16} weight="fill" className="shrink-0" />
          <span>UX Lab — same pick flow as production. Nothing is saved to this order.</span>
        </div>
      )}
      <header className="z-40 shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 backdrop-blur-md">
        <div className="flex items-start gap-2 px-3 py-3 sm:px-4">
          <button
            onClick={onBack}
            className="min-h-11 min-w-11 flex shrink-0 items-center justify-center rounded-xl text-[var(--content-secondary)] pick-pressable"
            aria-label="Back to queue"
          >
            <CaretLeft size={24} weight="bold" />
          </button>
          <div className="min-w-0 flex-1 pt-0.5">
            <h1 className="truncate text-sm font-bold tracking-tight text-[var(--content-primary)]">
              {order.customer_name}
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {order.customer_city && (
                <p className="truncate text-[11px] text-[var(--content-tertiary)]">
                  {order.customer_city}
                </p>
              )}
              {order.transport_name ? (
                <TransportChip name={order.transport_name} size="sm" />
              ) : (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-warning)]">
                  No transport
                </span>
              )}
              {order.priority === 'urgent' && <StatusBadge status="urgent" />}
            </div>
            {formatBilledLabel(order.approved_at, order.created_at) && (
              <p className="mt-1 text-[10px] font-medium text-[var(--content-quaternary)]">
                {formatBilledLabel(order.approved_at, order.created_at)}
                {' · '}
                <span className="font-mono">{order.order_number}</span>
              </p>
            )}
          </div>
          <div className="shrink-0 text-right tabular-nums">
            <p className="font-mono text-3xl font-extrabold leading-none tracking-tight text-[var(--content-primary)]">
              {counts.picked + counts.flagged}
              <span className="text-sm font-normal text-[var(--content-tertiary)]">
                /{counts.total}
              </span>
            </p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              lines done
            </p>
          </div>
        </div>
        <div className="mx-3 mb-2 h-1 overflow-hidden rounded bg-[var(--border-subtle)] sm:mx-4">
          <div
            className="h-full rounded bg-[var(--bg-inverse-primary)] transition-all duration-500"
            style={{ width: `${pickProgressPct}%` }}
          />
        </div>
      </header>

      <div className="pick-page-main mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col overflow-hidden px-1.5 pt-2 sm:px-2">
        {deckItems.length > 0 ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
            <div className="flex h-full min-h-0 flex-1 flex-col">
            <PickSwipeDeck
              currentIndex={safeCardIndex}
              itemCount={deckItems.length}
              onIndexChange={handleCardIndexChange}
              onSwipeUp={() => {
                appHaptics.impactLight();
                setQueueSheetOpen(true);
              }}
              onSwipeUpDrag={setQueueDragProgress}
              onSwipeUpDragEnd={() => setQueueDragProgress(0)}
              dotStatus={deckDotStatus}
            >
              {deckItems.map((pi, index) => {
                const targetQty = pickQuantityTarget(pi.orderItem);
                const cardLineMrp = lineMrpMap.get(pi.orderItem.id);
                const effectiveTargetQty = cardLineMrp?.originalTargetQty ?? targetQty;
                const pickedQty = isSplitMode(cardLineMrp)
                  ? pickLineSegmentsCommittedQty(cardLineMrp)
                  : Math.min(
                      targetQty,
                      getPickedQtyFromResult(pi.scanResult),
                    );
                const isCardCurrent = index === safeCardIndex;
                const rackVerified = rackVerifiedIds.has(pi.orderItem.id);
                const showShelf =
                  isCardCurrent &&
                  rackVerified &&
                  shelfQuery.data?.layers &&
                  currentDeckItem?.orderItem.id === pi.orderItem.id;
                const cardOutcome =
                  lineOutcome?.itemId === pi.orderItem.id ? lineOutcome : null;
                const outcomeHeadline = cardOutcome
                  ? pickOutcomeHeadline(
                      cardOutcome.kind,
                      cardOutcome.pickedQty ?? pickedQty,
                      isSplitMode(cardLineMrp) ? effectiveTargetQty : targetQty,
                      cardOutcome.reason,
                    )
                  : undefined;
                const outcomeDetail = cardOutcome
                  ? pickOutcomeDetail(
                      cardOutcome.kind,
                      isSplitMode(cardLineMrp) ? effectiveTargetQty : targetQty,
                      cardOutcome.pickedQty ?? pickedQty,
                    )
                  : undefined;
                const cardShelfMrpBands =
                  showShelf && shelfQuery.data?.layers
                    ? distinctShelfMrpCount(shelfQuery.data.layers)
                    : 0;
                return (
                  <div key={pi.orderItem.id} className="h-full w-full shrink-0 px-0.5">
                    {mountedDeckIndices.has(index) ? (
                    <PickCard
                      orderItem={pi.orderItem}
                      uiState={pi.uiState}
                      scanResult={pi.scanResult}
                      phase={
                        cardOutcome?.kind === 'picked' || cardOutcome?.kind === 'partial'
                          ? 'celebrating'
                          : pi.uiState === 'flagged'
                            ? 'flagged'
                            : !rackVerified
                              ? 'awaiting_rack'
                              : 'verified'
                      }
                      isCurrent={isCardCurrent}
                      rackVerified={rackVerified}
                      pickedQty={pickedQty}
                      targetQty={targetQty}
                      positionLabel={`${orderItemBrandLabel(pi.orderItem)} · ${index + 1} of ${deckItems.length}`}
                      flagReason={pi.orderItem.flag_reason}
                      scannerPaused={scannerPaused || !isCardCurrent}
                      lineOutcome={cardOutcome?.kind ?? null}
                      outcomeHeadline={outcomeHeadline}
                      outcomeDetail={outcomeDetail}
                      onAdvanceNext={isCardCurrent ? advanceToNextItem : undefined}
                      nextLinePreview={isCardCurrent ? advanceNextPreview : null}
                      shelfLayers={showShelf ? shelfQuery.data?.layers ?? null : null}
                      shelfLoading={isCardCurrent && rackVerified && shelfQuery.isLoading}
                      preferredLayerId={
                        preferredPickLayer?.orderItemId === pi.orderItem.id
                          ? preferredPickLayer.layerId
                          : null
                      }
                      mrpHistory={
                        isCardCurrent && rackVerified ? (mrpHistoryData?.history ?? []) : []
                      }
                      mrpHistoryLoading={isCardCurrent && rackVerified && mrpHistoryLoading}
                      lineMrp={lineMrpMap.get(pi.orderItem.id)}
                      cameraEngaged={
                        engagedScanner?.itemId === pi.orderItem.id &&
                        !scannerPaused
                      }
                      onRackTap={() => {
                        if (!rackVerifiedIds.has(pi.orderItem.id)) {
                          markRackVerified(pi.orderItem.id, 'override');
                        }
                      }}
                      onManualQty={() => openManualQty(pi.orderItem)}
                      onEditMrp={() => {
                        const history =
                          isCardCurrent && rackVerified ? (mrpHistoryData?.history ?? []) : [];
                        const splitSuggested = shouldSuggestMrpSplit(
                          history.length,
                          targetQty,
                          cardShelfMrpBands,
                        );
                        if (!isSplitMode(cardLineMrp) && splitSuggested) {
                          updateLineMrp(
                            pi.orderItem.id,
                            enterSplitMode(cardLineMrp, pi.orderItem.id, targetQty),
                          );
                          openMrpSheet(pi.orderItem.id, true);
                          return;
                        }
                        openMrpSheet(pi.orderItem.id, isSplitMode(cardLineMrp));
                      }}
                      onConfirmMrp={() => {
                        const history =
                          isCardCurrent && rackVerified ? (mrpHistoryData?.history ?? []) : [];
                        if (
                          !isSplitMode(cardLineMrp) &&
                          shouldSuggestMrpSplit(history.length, targetQty, cardShelfMrpBands)
                        ) {
                          handlePickFirstBatch(pi.orderItem);
                          return;
                        }
                        openMrpSheet(pi.orderItem.id, false);
                      }}
                      onMarkPicked={
                        isCardCurrent ? () => handleMarkPicked(pi.orderItem) : undefined
                      }
                      markPickedLabel={
                        isCardCurrent && targetQty > pickedQty
                          ? `Mark picked · ${targetQty - pickedQty} pcs`
                          : 'Mark picked'
                      }
                      onUndoLinePick={
                        isCardCurrent
                          ? () => requestRevertPick(pi.orderItem.id, 'full')
                          : undefined
                      }
                      onUndoLineQty={
                        isCardCurrent
                          ? () => requestRevertPick(pi.orderItem.id, 'qty_only')
                          : undefined
                      }
                      onResetSplitLine={
                        isCardCurrent
                          ? () => requestRevertPick(pi.orderItem.id, 'full')
                          : undefined
                      }
                      onFlag={() => openFlagSheet(pi.orderItem.id)}
                      onEngageScanner={() =>
                        engageScanner(
                          pi.orderItem,
                          rackVerified ? 'item' : 'rack',
                        )
                      }
                      onSelectLayer={(layerId) =>
                        setPreferredPickLayer({
                          orderItemId: pi.orderItem.id,
                          layerId,
                        })
                      }
                      onPickFirstBatch={() => handlePickFirstBatch(pi.orderItem)}
                      onPickNextMrp={() => handlePickNextMrp(pi.orderItem)}
                      onAllSameMrp={() => handleAllSameMrp(pi.orderItem)}
                      onConfirmBatch={() => handleConfirmBatch(pi.orderItem)}
                      onFinishShort={() => handleFinishShortSplit(pi.orderItem)}
                      onUndoLastSegment={() => void handleUndoLastSegment(pi.orderItem)}
                      activeBatchQty={getActiveSegment(lineMrpMap.get(pi.orderItem.id))?.qty ?? 0}
                    />
                    ) : null}
                  </div>
                );
              })}
            </PickSwipeDeck>
            </div>

            {scannerHint && (
              <p className="shrink-0 text-xs text-[var(--content-secondary)] bg-[var(--bg-tertiary)] rounded-lg px-3 py-1.5">
                {scannerHint}
              </p>
            )}

            {!queueSheetOpen && (
              <PickLineStatusPanel
                rows={pickStatusRows}
                currentItemId={currentDeckItem?.orderItem.id ?? null}
                pickedCount={counts.picked}
                flaggedCount={counts.flagged}
                remainingCount={counts.remaining}
                totalCount={counts.total}
                dragProgress={queueDragProgress}
                onJump={jumpToItem}
                onOpenQueue={() => {
                  appHaptics.selection();
                  setQueueSheetOpen(true);
                }}
                onQueueDrag={setQueueDragProgress}
                onQueueDragEnd={() => setQueueDragProgress(0)}
              />
            )}
          </div>
        ) : (
          <div className="ds-card p-6 text-center">
            <div className="w-14 h-14 bg-[var(--bg-positive-subtle)] rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle size={28} weight="fill" className="text-[var(--content-positive)]" />
            </div>
            <p className="font-bold text-lg text-[var(--content-primary)]">{order.customer_name}</p>
            {order.transport_name && (
              <p className="mt-1 text-sm text-[var(--content-secondary)]">{order.transport_name}</p>
            )}
            <p className="mt-3 text-sm text-[var(--content-tertiary)]">
              All lines handled — open the finish sheet below to send to billing.
            </p>
          </div>
        )}

      </div>

      {/* Finish pick — party-first confirmation sheet */}
      <BottomSheet
        isOpen={allDone && completeSheetOpen}
        onClose={() => setCompleteSheetOpen(false)}
        title="Finish this pick"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 space-y-2">
            <p className="text-xl font-bold text-[var(--content-primary)] leading-tight">
              {order.customer_name}
            </p>
            {order.customer_city && (
              <p className="text-sm text-[var(--content-secondary)]">{order.customer_city}</p>
            )}
            {formatBilledLabel(order.approved_at, order.created_at) && (
              <p className="text-sm text-[var(--content-tertiary)]">
                {formatBilledLabel(order.approved_at, order.created_at)}
              </p>
            )}
            <div className="pt-1">
              {order.transport_name ? (
                <TransportChip name={order.transport_name} size="md" />
              ) : (
                <p className="text-sm font-semibold text-[var(--content-warning)]">
                  No transport on order
                </p>
              )}
            </div>
            <p className="font-mono text-xs text-[var(--content-quaternary)] pt-1">
              {order.order_number}
            </p>
          </div>

          <div className="rounded-xl bg-[var(--bg-tertiary)] px-4 py-3 text-sm text-[var(--content-secondary)] space-y-1">
            <p className="tabular-nums">
              {formatLineCountLabel(counts.picked, { short: true })} picked
              {counts.flagged > 0 && (
                <span className="text-[var(--content-negative)]">
                  {' '}
                  · {counts.flagged} flagged
                </span>
              )}
            </p>
            <p className="tabular-nums text-[var(--content-tertiary)]">
              {pieceTotals.picked}/{pieceTotals.target} pcs picked
            </p>
          </div>

          <BigButton
            variant="primary"
            onClick={() => {
              appHaptics.impactMedium();
              completeMutation.mutate();
            }}
            loading={completeMutation.isPending}
            className={
              hasFlagged
                ? 'bg-[var(--bg-warning)] text-[var(--content-primary)]'
                : 'bg-[var(--bg-positive)] text-[var(--content-on-color)]'
            }
          >
            {hasFlagged ? (
              <>
                <Warning size={20} weight="bold" />
                Send to billing with {counts.flagged} flagged
              </>
            ) : (
              <>
                <ArrowRight size={20} weight="bold" />
                Finish pick for {order.customer_name.split(/\s+/)[0]}
              </>
            )}
          </BigButton>
        </div>
      </BottomSheet>

      {allDone && !completeSheetOpen && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
          <button
            type="button"
            onClick={() => setCompleteSheetOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--bg-positive)] py-3 text-sm font-semibold text-[var(--content-on-color)]"
          >
            <CheckCircle size={18} weight="fill" />
            Finish pick — {order.customer_name}
          </button>
        </div>
      )}

      {/* Flag reason sheet */}
      <FlagReasonSheet
        isOpen={flagSheetOpen}
        onClose={() => {
          setFlagSheetOpen(false);
          setFlagTargetItemId(null);
        }}
        onSubmit={handleFlagSubmit}
        loading={itemTransitionMutation.isPending}
      />

      {engagedScannerContext && !scannerPaused && (
        <LiveQrScanner
          continuous
          title={engagedScannerContext.title}
          eyebrow={engagedScannerContext.eyebrow}
          idleStatus="Point QR in frame — scans continuously"
          pickItem={{
            itemId: engagedScannerContext.orderItem.item_id,
            name: engagedScannerContext.orderItem.item_name,
            alias1: engagedScannerContext.orderItem.catalog_alias1 ?? null,
            alias:
              engagedScannerContext.orderItem.catalog_alias ??
              engagedScannerContext.orderItem.item_alias,
            itemCode: engagedScannerContext.orderItem.item_alias,
            busyCode: engagedScannerContext.busyCode,
            mainGroup: null,
            parentGroup: null,
          }}
          pickedSoFar={engagedScannerContext.pickedQty}
          targetQty={engagedScannerContext.targetQty}
          onClose={() => setEngagedScanner(null)}
          onResolved={makeEmbeddedScanHandler(
            engagedScannerContext.orderItem,
            engagedScannerContext.mode,
          )}
          onScanAccepted={makeEmbeddedScanHandler(
            engagedScannerContext.orderItem,
            engagedScannerContext.mode,
          )}
          onManualVerify={() => openManualQty(engagedScannerContext.orderItem)}
          onError={(message) => setScannerHint(message)}
        />
      )}

      <BottomSheet
        isOpen={fifoOverrideSheet !== null}
        onClose={() => {
          setFifoOverrideSheet(null);
          setFifoOverrideReason('');
        }}
        title="FIFO override"
     >
        <div className="space-y-4">
          <p className="text-sm text-[var(--content-secondary)]">
            You selected a newer MRP batch or the system needs a written reason. Enter a short warehouse note (who
            asked, why).
          </p>
          <textarea
            value={fifoOverrideReason}
            onChange={(e) => setFifoOverrideReason(e.target.value)}
            placeholder="Reason (required, min 3 characters)"
            className="w-full min-h-24 px-4 py-3 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-primary)] border border-[var(--border-subtle)]"
          />
          <BigButton
            variant="primary"
            className="bg-[var(--bg-accent)] text-[var(--content-on-color)]"
            loading={itemTransitionMutation.isPending}
            onClick={() => void confirmFifoOverride()}
          >
            Confirm and apply pick
          </BigButton>
        </div>
      </BottomSheet>

      <BottomSheet
        isOpen={pendingPackConfirmation !== null}
        onClose={() => setPendingPackConfirmation(null)}
        title="Qty Confirmation"
      >
        {pendingPackConfirmation && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--content-secondary)]">
              This scan suggests picking {pendingPackConfirmation.suggestedQty} units while
              remaining qty is {pendingPackConfirmation.targetQty}. Confirm the qty before applying.
            </p>
            {pendingPackConfirmation.scanResult.uomHint ? (
              <p className="text-sm font-semibold text-[var(--content-primary)]">
                {pendingPackConfirmation.scanResult.uomHint}
              </p>
            ) : null}
            <div className="flex gap-2">
              <BigButton
                variant="secondary"
                onClick={() => setPendingPackConfirmation(null)}
                className="flex-1"
              >
                Cancel
              </BigButton>
              <BigButton
                variant="primary"
                onClick={() => {
                  const pending = pendingPackConfirmation;
                  if (!pending) return;
                  setPendingPackConfirmation(null);
                  void applyPickedQty(pending.orderItemId, pending.suggestedQty);
                }}
                className="flex-1 bg-[var(--bg-warning)] text-[var(--content-primary)]"
              >
                Apply Qty
              </BigButton>
              <BigButton
                variant="primary"
                onClick={() => {
                  const pending = pendingPackConfirmation;
                  if (!pending) return;
                  setPendingPackConfirmation(null);
                  setManualQtyTargetItemId(pending.orderItemId);
                  setManualQtyInitial(Math.max(1, pending.targetQty));
                }}
                className="flex-1 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
              >
                Enter Manually
              </BigButton>
            </div>
          </div>
        )}
      </BottomSheet>

      <PickQtySheet
        isOpen={manualQtyTargetItemId !== null}
        initialQty={manualQtyInitial}
        targetQty={manualQtyOrderItem ? pickQuantityTarget(manualQtyOrderItem) : 0}
        pickedQty={manualQtyPicked}
        segmentMrp={manualQtySegmentMrp}
        lineRemaining={manualQtyLineRemaining}
        partCode={
          manualQtyOrderItem?.catalog_alias1 ??
          manualQtyOrderItem?.catalog_alias ??
          manualQtyOrderItem?.item_alias ??
          null
        }
        rackNo={manualQtyOrderItem?.rack_no ?? null}
        onConfirm={(qty) => {
          const itemId = manualQtyTargetItemId;
          if (itemId == null) return;
          if (!rackVerifiedIds.has(itemId)) {
            markRackVerified(itemId, 'override');
          }
          const lineMrp = lineMrpMap.get(itemId);
          if (isSplitMode(lineMrp) && getActiveSegment(lineMrp)) {
            setActiveBatchQty(itemId, qty);
            setManualQtyTargetItemId(null);
            return;
          }
          void applyPickedQty(itemId, qty);
          setManualQtyTargetItemId(null);
        }}
        onOutOfStock={() => {
          const itemId = manualQtyTargetItemId;
          if (itemId == null) return;
          flagOutOfStock(itemId);
          setManualQtyTargetItemId(null);
        }}
        onClose={() => setManualQtyTargetItemId(null)}
      />

      {mrpSheetItemId != null && mrpFocusItem && (
        <MrpHistorySheet
          isOpen
          history={mrpHistoryData?.history ?? []}
          isLoading={mrpHistoryLoading}
          confirmedMrp={lineMrpMap.get(mrpSheetItemId)?.confirmedMrp ?? null}
          customMrp={lineMrpMap.get(mrpSheetItemId)?.customMrp ?? null}
          selectBatchMode={mrpSheetUsesBatchMode(mrpSheetItemId)}
          partCode={
            mrpFocusItem.catalog_alias1 ??
            mrpFocusItem.catalog_alias ??
            mrpFocusItem.item_alias ??
            null
          }
          rackNo={mrpFocusItem.rack_no}
          onSelectMrp={(mrp) => {
            if (mrpSheetUsesBatchMode(mrpSheetItemId)) {
              const targetQty = pickQuantityTarget(mrpFocusItem);
              const splitState = ensureSplitLineMrp(mrpSheetItemId, targetQty);
              updateLineMrp(mrpSheetItemId, startActiveSegment(splitState, mrp, false));
            } else {
              updateLineMrp(mrpSheetItemId, { confirmedMrp: mrp, customMrp: null });
            }
            closeMrpSheet();
          }}
          onSelectCustomMrp={(mrp) => {
            if (mrpSheetUsesBatchMode(mrpSheetItemId)) {
              const targetQty = pickQuantityTarget(mrpFocusItem);
              const splitState = ensureSplitLineMrp(mrpSheetItemId, targetQty);
              updateLineMrp(mrpSheetItemId, startActiveSegment(splitState, mrp, true));
            } else {
              updateLineMrp(mrpSheetItemId, { customMrp: mrp, confirmedMrp: null });
            }
            closeMrpSheet();
          }}
          onClose={closeMrpSheet}
        />
      )}

      <JumpListSheet
        isOpen={queueSheetOpen}
        onClose={() => setQueueSheetOpen(false)}
        transportName={order.transport_name}
        customerName={order.customer_name}
        billedAt={order.approved_at ?? order.created_at}
        orderNumber={order.order_number}
        rows={queueSheetRows}
        counts={{
          picked: counts.picked,
          flagged: counts.flagged,
          remaining: counts.remaining,
          total: counts.total,
          packAssisted: visibility.packAssisted,
          manual: visibility.manual,
          reasonBadges: visibility.reasonBadges,
        }}
        currentItemId={currentDeckItem?.orderItem.id ?? null}
        onSkipItem={(itemId, reason) => {
          skipItem(itemId, reason);
          setQueueSheetOpen(false);
        }}
        onJump={jumpToItem}
        onCompleteItem={completeQueueItem}
      />

      {/* Undo toast — top-right, 5s window. The only escape hatch we expose,
          so we don't tempt pickers into deeper rollbacks. After the window,
          a wrong pick can still be flagged/overridden through the normal flow. */}
      <BottomSheet
        isOpen={revertConfirm !== null}
        onClose={() => {
          if (revertPickPending) return;
          setRevertConfirm(null);
        }}
        title={revertConfirm?.mode === 'qty_only' ? 'Reset qty?' : 'Reset this line?'}
      >
        {revertConfirm && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--content-secondary)]">
              {revertConfirm.mode === 'qty_only'
                ? `Clear picked qty on ${revertConfirm.itemName}. MRP stays — pick the qty again.`
                : `Clear qty and MRP on ${revertConfirm.itemName}. You'll verify rack, MRP, and qty again.`}
            </p>
            <div className="flex gap-2">
              <BigButton
                variant="secondary"
                onClick={() => setRevertConfirm(null)}
                className="flex-1"
                disabled={revertPickPending}
              >
                Cancel
              </BigButton>
              <BigButton
                variant="primary"
                loading={revertPickPending}
                onClick={() =>
                  void executeRevertPick(revertConfirm.itemId, revertConfirm.mode)
                }
                className="flex-1 bg-[var(--bg-warning)] text-[var(--content-primary)]"
              >
                {revertConfirm.mode === 'qty_only' ? 'Reset qty' : 'Reset line'}
              </BigButton>
            </div>
          </div>
        )}
      </BottomSheet>

      {undoSnapshot && (
        <div
          className="fixed top-3 right-3 z-[80] max-w-[calc(100vw-1.5rem)] animate-undo-toast-enter"
          role="status"
        >
          <div className="flex items-center gap-3 rounded-2xl bg-[var(--bg-inverse-primary)] text-[var(--content-on-color)] px-4 py-3 shadow-lg">
            <CheckCircle size={18} weight="fill" className="text-[var(--bg-positive)] shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold leading-tight">Picked</p>
              <p className="font-mono text-[11px] opacity-80 truncate max-w-[180px]">
                {undoSnapshot.itemCode ?? undoSnapshot.itemName}
              </p>
            </div>
            <button
              type="button"
              onClick={revertLastPick}
              className="ml-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 text-xs font-semibold pick-pressable"
            >
              <ArrowCounterClockwise size={14} weight="bold" />
              Undo
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
