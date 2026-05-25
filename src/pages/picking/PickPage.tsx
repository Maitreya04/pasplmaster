import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  CaretLeft,
  Warning,
  MapPin,
  ArrowRight,
  ArrowCounterClockwise,
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
  buildPickWalkBrandSections,
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
import {
  mergeMrpIntoScanResult,
  readPickLineMrpMap,
  writePickLineMrpMap,
  type PickLineMrpState,
} from '../../lib/picking/pickLineMrp';
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
const CARD_INDEX_STORAGE_KEY = 'paspl.pick.cardIndex.v1';

const RACK_VERIFY_STORAGE_KEY = 'paspl.pick.rackVerified.v1';
const SKIPPED_STORAGE_KEY = 'paspl.pick.skipped.v1';
const BRIEF_ACK_STORAGE_KEY = 'paspl.pick.briefAck.v1';

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

function readBriefAck(orderId: number | null): boolean {
  if (!orderId || typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(`${BRIEF_ACK_STORAGE_KEY}:${orderId}`) === '1';
}

function writeBriefAck(orderId: number | null, ack: boolean): void {
  if (!orderId || typeof window === 'undefined') return;
  if (ack) {
    window.sessionStorage.setItem(`${BRIEF_ACK_STORAGE_KEY}:${orderId}`, '1');
  } else {
    window.sessionStorage.removeItem(`${BRIEF_ACK_STORAGE_KEY}:${orderId}`);
  }
}

function readCardIndex(orderId: number | null): number {
  if (!orderId || typeof window === 'undefined') return 0;
  try {
    const raw = window.sessionStorage.getItem(`${CARD_INDEX_STORAGE_KEY}:${orderId}`);
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeCardIndex(orderId: number | null, index: number): void {
  if (!orderId || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(`${CARD_INDEX_STORAGE_KEY}:${orderId}`, String(index));
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

function buildPriceMismatchNotes(rawNotes: string, boxPrice: number): string {
  const base = rawNotes.trim();
  const structured = `Price mismatch detected at picking. Box price ₹${boxPrice.toFixed(2)}.`;
  return base ? `${structured} Picker note: ${base}` : structured;
}

function getPickedQtyFromResult(result: ScanResult | null | undefined): number {
  return Math.max(0, result?.progress?.pickedQty ?? 0);
}

export default function PickPage(): React.JSX.Element | null {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userName, userId } = useAuth();
  const transitionAdapter = defaultPickItemTransitionAdapter;

  const orderId = id ? parseInt(id, 10) : null;
  const { data: order, isLoading, error } = useOrderDetail(orderId);

  // Assigned but not started — send picker through preview + Start gate.
  useEffect(() => {
    if (!orderId || !order) return;
    if (order.workflow_status === 'approved') {
      navigate(`/picking/preview/${orderId}`, { replace: true });
    }
  }, [navigate, order, orderId]);

  // Initialize work claim for heartbeats
  const { claimId, isClaimedByMe, claim, error: claimError } = useWorkClaim(
    orderId,
    'picking'
  );

  // Auto-claim if picking (usually claimed in QueuePage, this starts the heartbeat)
  useEffect(() => {
    if (order?.workflow_status === 'picking' && !isClaimedByMe && !claimError) {
      claim();
    }
  }, [order?.workflow_status, isClaimedByMe, claim, claimError]);

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
  // briefAcknowledged: has the picker dismissed the pre-start "trip summary"?
  // Persisted per-order so a refresh mid-pick doesn't re-prompt.
  const [briefAcknowledged, setBriefAcknowledged] = useState(false);
  // rackVerifiedIds: items whose rack the picker has confirmed (scanned QR or
  // long-press override). This is the gate-1 "I'm physically here" signal.
  const [rackVerifiedIds, setRackVerifiedIds] = useState<Set<number>>(new Set());
  // skippedIds: items the picker chose to come back to. Sorted to the end of
  // the queue so the natural rack-order keeps leading the route.
  const [skippedIds, setSkippedIds] = useState<Set<number>>(new Set());
  // lineOutcome: closure beat after pick or flag — green/amber card + explicit Next CTA.
  const [lineOutcome, setLineOutcome] = useState<LineOutcomeState | null>(null);
  // undoSnapshot: 5s window to revert the last completion. Captures the prior
  // scan_result + state so we can roll back both DB and local UI cleanly.
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [queueSheetOpen, setQueueSheetOpen] = useState(false);
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

  const orderItems = useMemo(
    () => (order?.items ? pickableOrderItems(order.items) : undefined),
    [order?.items],
  );

  // Hydrate per-order state from sessionStorage so a refresh doesn't force the
  // picker to re-scan racks or re-acknowledge the brief mid-flow.
  useEffect(() => {
    if (!orderId) return;
    setRackVerifiedIds(readIdSet(RACK_VERIFY_STORAGE_KEY, orderId));
    setSkippedIds(readIdSet(SKIPPED_STORAGE_KEY, orderId));
    setBriefAcknowledged(readBriefAck(orderId));
    setCurrentCardIndex(readCardIndex(orderId));
    setLineMrpMap(readPickLineMrpMap(orderId));
  }, [orderId]);

  useEffect(() => {
    writePickLineMrpMap(orderId, lineMrpMap);
  }, [orderId, lineMrpMap]);

  useEffect(() => {
    writeIdSet(RACK_VERIFY_STORAGE_KEY, orderId, rackVerifiedIds);
  }, [orderId, rackVerifiedIds]);

  useEffect(() => {
    writeIdSet(SKIPPED_STORAGE_KEY, orderId, skippedIds);
  }, [orderId, skippedIds]);

  useEffect(() => {
    writeBriefAck(orderId, briefAcknowledged);
  }, [orderId, briefAcknowledged]);

  useEffect(() => {
    writeCardIndex(orderId, currentCardIndex);
  }, [orderId, currentCardIndex]);

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
      if (local) {
        return {
          orderItem: oi,
          uiState: local.uiState ?? uiStateFromDb(oi),
          scanResult: local.scanResult ?? oi.scan_result,
        };
      }
      return {
        orderItem: oi,
        uiState: uiStateFromDb(oi),
        scanResult: oi.scan_result,
      };
    });
  }, [localItems, orderItems]);

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

  // Trip brief: brand blocks (Varroc → TVS → …) with rack stops inside each brand.
  const briefBrandSections = useMemo(() => {
    if (!orderItems?.length) return [];
    return buildPickWalkBrandSections(orderItems, pickQuantityTarget);
  }, [orderItems]);

  const briefTotals = useMemo(() => {
    const lines = orderItems?.length ?? 0;
    const pieces = orderItems?.reduce((sum, oi) => sum + pickQuantityTarget(oi), 0) ?? 0;
    return { lines, pieces };
  }, [orderItems]);

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

  // ─── Phase derivation ───
  // Single source of truth for what we render. Order matters: complete > brief
  // > line outcome > awaiting_rack > verified.
  type PickPhase =
    | { kind: 'brief' }
    | { kind: 'awaiting_rack'; itemId: number }
    | { kind: 'verified'; itemId: number }
    | { kind: 'line_outcome'; itemId: number }
    | { kind: 'complete' };

  const phase: PickPhase = useMemo(() => {
    if (!currentTarget) return { kind: 'complete' };
    if (lineOutcome) return { kind: 'line_outcome', itemId: lineOutcome.itemId };
    if (!briefAcknowledged && counts.picked + counts.flagged === 0) {
      return { kind: 'brief' };
    }
    if (rackVerifiedIds.has(currentTarget.orderItem.id)) {
      return { kind: 'verified', itemId: currentTarget.orderItem.id };
    }
    return { kind: 'awaiting_rack', itemId: currentTarget.orderItem.id };
  }, [currentTarget, lineOutcome, briefAcknowledged, counts.picked, counts.flagged, rackVerifiedIds]);

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

  const mrpFocusRackVerified =
    mrpFocusItem != null &&
    (rackVerifiedIds.has(mrpFocusItem.id) || mrpSheetItemId === mrpFocusItem.id);

  const { data: mrpHistoryData, isLoading: mrpHistoryLoading } = useStockMrpHistory(
    mrpFocusItem?.catalog_busy_code,
    (mrpFocusItem?.stock_location_code as StockLocationCode | null) ?? null,
    null,
    Boolean(mrpFocusItem && mrpFocusRackVerified),
  );

  const updateLineMrp = useCallback((itemId: number, patch: Partial<PickLineMrpState>) => {
    setLineMrpMap((prev) => {
      const next = new Map(prev);
      const existing = next.get(itemId) ?? { confirmedMrp: null, customMrp: null };
      next.set(itemId, { ...existing, ...patch });
      return next;
    });
  }, []);

  const openMrpSheet = useCallback((itemId: number) => {
    setMrpSheetItemId(itemId);
  }, []);

  /** Primary CTA only — confirm a single prefilled MRP without opening the sheet. */
  const confirmSingleMrp = useCallback(
    (itemId: number, mrp: number) => {
      updateLineMrp(itemId, { confirmedMrp: mrp, customMrp: null });
      appHaptics.success();
    },
    [updateLineMrp],
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

      if (!order || transition.kind !== 'flagged') return { itemId, previous };
      const { reason, notes, boxPrice } = transition;

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
            flagBoxPrice: boxPrice,
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
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });

  const tryConsumeShelfStock = useCallback(
    async (
      orderItem: OrderItem,
      qtyDelta: number,
      overrideReason?: string | null,
    ): Promise<'ok' | 'override_blocked' | 'abort'> => {
      if (qtyDelta <= 0) return 'ok';
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
    [preferredPickLayer, queryClient, toast, userId],
  );

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
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
    const local = localItems.get(orderItem.id);
    const targetQty = pickQuantityTarget(orderItem);
    const picked = Math.min(
      targetQty,
      getPickedQtyFromResult(local?.scanResult ?? orderItem.scan_result),
    );
    const remaining = Math.max(1, targetQty - picked);
    setManualQtyTargetItemId(orderItem.id);
    setManualQtyInitial(remaining);
    setScannerHint(null);
  }, [localItems]);

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

  const revertLastPick = useCallback(async () => {
    const snapshot = undoSnapshot;
    if (!snapshot) return;
    setUndoSnapshot(null);
    setLineOutcome(null);
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
  }, [orderId, queryClient, toast, undoSnapshot, updateLocalItem]);

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
  ]);

  const handleFlagSubmit = useCallback(
    (payload: FlagSubmitPayload) => {
      if (flagTargetItemId === null) return;
      appHaptics.impactMedium();
      const notes =
        payload.reason === 'Price Mismatch' && payload.boxPrice != null
          ? buildPriceMismatchNotes(payload.notes ?? '', payload.boxPrice)
          : payload.notes;
      itemTransitionMutation.mutate(
        {
          transition: {
            kind: 'flagged',
            itemId: flagTargetItemId,
            reason: payload.reason,
            notes,
            boxPrice: payload.boxPrice,
            scanResult: localItems.get(flagTargetItemId)?.scanResult ?? null,
          },
          optimisticState: 'flagged',
        },
        {
          onSuccess: () => {
            toast.info('Flag sent to billing');
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
    [beginLineOutcome, flagTargetItemId, itemTransitionMutation, localItems, toast],
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
    const target = pickQuantityTarget(manualQtyOrderItem);
    return Math.min(
      target,
      getPickedQtyFromResult(
        localItems.get(manualQtyOrderItem.id)?.scanResult ?? manualQtyOrderItem.scan_result,
      ),
    );
  }, [localItems, manualQtyOrderItem]);

  const isBriefPhase = phase.kind === 'brief';

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
      };
    });
  }, [currentDeckItem?.orderItem.id, deckItems, lineOutcome, skippedIds]);

  const pickProgressPct =
    counts.total > 0 ? ((counts.picked + counts.flagged) / counts.total) * 100 : 0;

  if (!orderId) {
    navigate('/picking');
    return null;
  }

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
          onClick={() => navigate('/picking')}
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
              onClick={() => navigate('/picking')}
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
          <BigButton variant="secondary" onClick={() => navigate('/picking')} className="mt-4">
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
    <div className="role-picking min-h-[100dvh] bg-[var(--bg-primary)] pb-32">
      <header className="sticky top-0 z-40 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 backdrop-blur-md">
        <div className="flex items-start gap-2 px-3 py-3 sm:px-4">
          <button
            onClick={() => navigate('/picking')}
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

      <div className="mx-auto w-full max-w-lg px-1.5 pt-2 space-y-3 sm:px-2">
        {isBriefPhase ? (
          /* ─── Order Brief: trip summary before walking the route ─── */
          <div className="space-y-4 animate-pick-stop-enter">
            <div className="ds-card p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                Ready to pick
              </p>
              <h2 className="text-2xl font-bold text-[var(--content-primary)] mt-1 leading-tight">
                {order.customer_name}
              </h2>
              {order.customer_city && (
                <p className="mt-1 text-sm text-[var(--content-secondary)]">
                  {order.customer_city}
                </p>
              )}
              {formatBilledLabel(order.approved_at, order.created_at) && (
                <p className="mt-2 text-sm font-medium text-[var(--content-secondary)]">
                  {formatBilledLabel(order.approved_at, order.created_at)}
                </p>
              )}
              <div className="mt-3">
                {order.transport_name ? (
                  <TransportChip name={order.transport_name} size="md" />
                ) : (
                  <p className="text-sm text-[var(--content-warning)] font-semibold">
                    No transport set — confirm with billing before dispatch
                  </p>
                )}
              </div>
              <p className="mt-4 text-sm text-[var(--content-tertiary)]">
                {formatLineCountLabel(briefTotals.lines, { short: true })}
                {' · '}
                {briefBrandSections.length} brand{briefBrandSections.length === 1 ? '' : 's'}
                {' · '}
                {briefTotals.pieces} pcs total
              </p>
              <p className="mt-1 font-mono text-xs text-[var(--content-quaternary)]">
                {order.order_number}
              </p>
            </div>

            <div className="ds-card p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] mb-2">
                Route — brand by brand
              </p>
              <div className="space-y-4">
                {briefBrandSections.map((section) => (
                  <div key={section.brand}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <p className="text-sm font-bold text-[var(--content-primary)]">{section.brand}</p>
                      <p className="text-[10px] font-medium text-[var(--content-tertiary)] tabular-nums">
                        {section.lines} line{section.lines === 1 ? '' : 's'} · {section.pieces} pcs
                      </p>
                    </div>
                    <div className="space-y-1 border-l-2 border-[var(--border-faint)] pl-3">
                      {section.racks.map((r, idx) => (
                        <div
                          key={`${section.brand}-${r.rack ?? 'norack'}-${idx}`}
                          className="flex items-center gap-2 py-0.5"
                        >
                          <MapPin size={12} weight="regular" className="text-[var(--content-tertiary)] shrink-0" />
                          <span className="font-mono text-xs font-bold text-[var(--content-primary)] min-w-12">
                            {r.rack ?? '—'}
                          </span>
                          <span className="text-[10px] text-[var(--content-tertiary)] flex-1">
                            {r.lines} line{r.lines === 1 ? '' : 's'}
                          </span>
                          <span className="font-mono text-[10px] font-semibold text-[var(--content-secondary)] tabular-nums">
                            {r.pieces} pcs
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <BigButton
              variant="primary"
              onClick={() => {
                appHaptics.impactMedium();
                setBriefAcknowledged(true);
              }}
              className="bg-[var(--bg-inverse-primary)] text-[var(--content-on-color)]"
            >
              <ArrowRight size={20} weight="bold" />
              Start picking
            </BigButton>
          </div>
        ) : deckItems.length > 0 ? (
          <div className="space-y-3">
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
                const pickedQty = Math.min(
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
                      targetQty,
                      cardOutcome.reason,
                    )
                  : undefined;
                const outcomeDetail = cardOutcome
                  ? pickOutcomeDetail(cardOutcome.kind, targetQty, cardOutcome.pickedQty ?? pickedQty)
                  : undefined;
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
                      onEditMrp={() => openMrpSheet(pi.orderItem.id)}
                      onConfirmMrp={() => {
                        const history =
                          isCardCurrent && rackVerified ? (mrpHistoryData?.history ?? []) : [];
                        if (history.length === 1) {
                          confirmSingleMrp(pi.orderItem.id, history[0]!.mrp);
                          return;
                        }
                        openMrpSheet(pi.orderItem.id);
                      }}
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
                    />
                    ) : null}
                  </div>
                );
              })}
            </PickSwipeDeck>

            {scannerHint && (
              <p className="text-xs text-[var(--content-secondary)] bg-[var(--bg-tertiary)] rounded-lg px-3 py-2">
                {scannerHint}
              </p>
            )}

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
            />
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
          confirmedMrp={lineMrpMap.get(mrpSheetItemId)?.confirmedMrp ?? null}
          customMrp={lineMrpMap.get(mrpSheetItemId)?.customMrp ?? null}
          partCode={
            mrpFocusItem.catalog_alias1 ??
            mrpFocusItem.catalog_alias ??
            mrpFocusItem.item_alias ??
            null
          }
          rackNo={mrpFocusItem.rack_no}
          onSelectMrp={(mrp) => {
            updateLineMrp(mrpSheetItemId, { confirmedMrp: mrp, customMrp: null });
            setMrpSheetItemId(null);
          }}
          onSelectCustomMrp={(mrp) => {
            updateLineMrp(mrpSheetItemId, { customMrp: mrp, confirmedMrp: null });
            setMrpSheetItemId(null);
          }}
          onClose={() => setMrpSheetItemId(null)}
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
