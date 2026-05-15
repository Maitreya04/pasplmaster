import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  Flag,
  CaretLeft,
  Warning,
  Camera,
  MapPin,
  ArrowRight,
  Check,
  ListChecks,
  ArrowUp,
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
  LiveQrScanner,
  ProgressBar,
  Skeleton,
  StatusBadge,
} from '../../components/shared';
import type { OrderItem, OrderItemState, ScanResult } from '../../types';
import { FLAG_REASONS, type FlagReason } from '../../utils/constants';
import { PickCompleteScreen } from './PickCompleteScreen';
import { QueueSheet, type QueueSheetRow } from './QueueSheet';
import { pickQuantityTarget } from '../../lib/cartSupply';
import { appHaptics } from '../../lib/haptics';
import { sendInternalNotification } from '../../lib/pickerPush';
import type { LiveQrScannerResolved } from '../../components/shared/LiveQrScanner';
import {
  PACK_DEFINITIONS_QUERY_KEY,
  fetchItemPackDefinitions,
  type ItemPackDefinition,
} from '../../lib/packLpn';
import {
  classifyScanPayload,
  parsePackPickPayload,
  parseLpnPickPayload,
  rackCodesMatch,
} from '../../lib/scanner/qrPayload';
import {
  defaultPickItemTransitionAdapter,
  type PickItemTransition,
} from '../../lib/picking/itemTransitionAdapter';

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

interface LiveScanSession {
  orderItem: OrderItem;
  previousUiState: PickItemUiState;
  previousScanResult: ScanResult | null;
}

interface PendingPackConfirmation {
  orderItemId: number;
  scanResult: ScanResult;
  suggestedQty: number;
  targetQty: number;
}

const DUPLICATE_SCAN_WINDOW_MS = 1200;
const MAX_AUTO_SCAN_QTY = 12;

// ─── Pick flow constants ───
// 700ms green-dwell after a line completes — long enough for the picker to
// register the win, short enough to keep warehouse pace.
const CELEBRATE_DURATION_MS = 700;
// 5s undo window. Slips happen; mistakes get flagged. Five seconds is the
// sweet spot we tested behaviourally — long enough to react, short enough
// not to slow the next pick.
const UNDO_DURATION_MS = 5000;
// 600ms long-press to mark a rack verified without scanning. Norman's
// "deliberate confirmation" for a constraint bypass — pickers shouldn't
// trip into this by accident.
const RACK_LONG_PRESS_MS = 600;

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

interface CelebratingState {
  itemId: number;
  expiresAt: number;
}

interface UndoSnapshot {
  itemId: number;
  itemName: string;
  itemCode: string | null;
  previousScanResult: ScanResult | null;
  previousState: OrderItemState;
  expiresAt: number;
}

interface PackSplitText {
  /** Human-readable line, e.g. "Pick 2 inner packs + 12 loose". Empty if not applicable. */
  text: string;
  /** True when the breakdown actually has multiple tiers. */
  hasMultipleTiers: boolean;
}

function describePackSplit(
  breakdown: PackBreakdown | null,
  packDef: ItemPackDefinition | null | undefined,
): PackSplitText {
  if (!breakdown) return { text: '', hasMultipleTiers: false };
  const parts: string[] = [];
  if (breakdown.hasOuter && breakdown.outerQty > 0) {
    const size = packDef?.outer_pack_qty ?? 0;
    parts.push(
      `${breakdown.outerQty} master${breakdown.outerQty === 1 ? '' : 's'}${size ? ` (×${size})` : ''}`,
    );
  }
  if (breakdown.hasInner && breakdown.innerQty > 0) {
    const size = packDef?.inner_pack_qty ?? 0;
    parts.push(
      `${breakdown.innerQty} inner${breakdown.innerQty === 1 ? '' : 's'}${size ? ` (×${size})` : ''}`,
    );
  }
  if (breakdown.looseQty > 0) {
    parts.push(`${breakdown.looseQty} loose`);
  }
  if (parts.length === 0) return { text: '', hasMultipleTiers: false };
  return { text: `Pick ${parts.join(' + ')}`, hasMultipleTiers: parts.length > 1 };
}

function sortByRack(items: OrderItem[]): OrderItem[] {
  return [...items].sort((a, b) => {
    if (!a.rack_no && !b.rack_no) return 0;
    if (!a.rack_no) return 1;
    if (!b.rack_no) return -1;
    return a.rack_no.localeCompare(b.rack_no, undefined, { numeric: true });
  });
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

function deriveBusyCodeCandidates(item: OrderItem): number[] {
  const candidates = [
    item.item_alias,
    item.catalog_alias,
    item.catalog_alias1,
  ];
  const values = new Set<number>();
  for (const value of candidates) {
    if (!value) continue;
    const digits = value.replace(/[^\d]/g, '');
    if (!digits) continue;
    const parsed = Number(digits);
    if (Number.isFinite(parsed) && parsed > 0) values.add(parsed);
  }
  return [...values];
}

function buildPriceMismatchNotes(rawNotes: string, boxPrice: number): string {
  const base = rawNotes.trim();
  const structured = `Price mismatch detected at picking. Box price ₹${boxPrice.toFixed(2)}.`;
  return base ? `${structured} Picker note: ${base}` : structured;
}

function isBenignScannerAbort(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes('operation was aborted') ||
    normalized.includes('the operation was aborted') ||
    normalized.includes('aborted')
  );
}

function getPickedQtyFromResult(result: ScanResult | null | undefined): number {
  return Math.max(0, result?.progress?.pickedQty ?? 0);
}

interface PackBreakdown {
  outerQty: number;
  outerPcs: number;
  innerQty: number;
  innerPcs: number;
  looseQty: number;
  totalPcs: number;
  hasOuter: boolean;
  hasInner: boolean;
  hasLoose: boolean;
}

function computePackBreakdown(
  targetQty: number,
  packDef: ItemPackDefinition | null | undefined,
): PackBreakdown {
  const outerSize = packDef?.outer_pack_qty ?? 0;
  const innerSize = packDef?.inner_pack_qty ?? 0;

  let remaining = targetQty;
  let outerQty = 0;
  let innerQty = 0;
  let looseQty = 0;

  if (outerSize > 0) {
    outerQty = Math.floor(remaining / outerSize);
    remaining = remaining % outerSize;
  }
  if (innerSize > 0) {
    innerQty = Math.floor(remaining / innerSize);
    remaining = remaining % innerSize;
  }
  looseQty = remaining;

  return {
    outerQty,
    outerPcs: outerQty * outerSize,
    innerQty,
    innerPcs: innerQty * innerSize,
    looseQty,
    totalPcs: targetQty,
    hasOuter: outerSize > 0,
    hasInner: innerSize > 0,
    hasLoose: looseQty > 0 || (outerSize === 0 && innerSize === 0),
  };
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

  const [flagTarget, setFlagTarget] = useState<number | null>(null);
  const [flagReason, setFlagReason] = useState<FlagReason | ''>('');
  const [flagNotes, setFlagNotes] = useState('');
  const [flagBoxPrice, setFlagBoxPrice] = useState('');
  const [liveScanSession, setLiveScanSession] = useState<LiveScanSession | null>(null);
  const [pendingPackConfirmation, setPendingPackConfirmation] =
    useState<PendingPackConfirmation | null>(null);
  const [manualQtyTargetItemId, setManualQtyTargetItemId] = useState<number | null>(null);
  const [manualQtyInput, setManualQtyInput] = useState('1');
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
  // Scanner mode: 'rack' opens the camera for bin license plate (location /
  // ITEM / pack QR); 'item' opens it for box picks.
  // it to scan box / pack / LPN labels.
  const [scannerMode, setScannerMode] = useState<'rack' | 'item'>('item');
  // celebrating: the just-completed item gets a 700ms green dwell before the
  // next stop slides in. Norman: feedback must be visible enough to register.
  const [celebrating, setCelebrating] = useState<CelebratingState | null>(null);
  // undoSnapshot: 5s window to revert the last completion. Captures the prior
  // scan_result + state so we can roll back both DB and local UI cleanly.
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);
  const [queueSheetOpen, setQueueSheetOpen] = useState(false);

  const orderItems = order?.items;

  // Hydrate per-order state from sessionStorage so a refresh doesn't force the
  // picker to re-scan racks or re-acknowledge the brief mid-flow.
  useEffect(() => {
    if (!orderId) return;
    setRackVerifiedIds(readIdSet(RACK_VERIFY_STORAGE_KEY, orderId));
    setSkippedIds(readIdSet(SKIPPED_STORAGE_KEY, orderId));
    setBriefAcknowledged(readBriefAck(orderId));
  }, [orderId]);

  useEffect(() => {
    writeIdSet(RACK_VERIFY_STORAGE_KEY, orderId, rackVerifiedIds);
  }, [orderId, rackVerifiedIds]);

  useEffect(() => {
    writeIdSet(SKIPPED_STORAGE_KEY, orderId, skippedIds);
  }, [orderId, skippedIds]);

  useEffect(() => {
    writeBriefAck(orderId, briefAcknowledged);
  }, [orderId, briefAcknowledged]);

  // Drive the celebrate window to clear itself; render falls back to the next
  // stop the moment we clear, so the slide-in animation triggers naturally.
  useEffect(() => {
    if (!celebrating) return;
    const remaining = Math.max(0, celebrating.expiresAt - Date.now());
    const t = setTimeout(() => setCelebrating(null), remaining);
    return () => clearTimeout(t);
  }, [celebrating]);

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
    const sorted = sortByRack(orderItems);
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

  const { active, done } = useMemo(() => partitionItems(pickItems), [pickItems]);

  // Re-order active so skipped items go to the end while preserving rack order
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

  const currentTarget = orderedActive[0] ?? null;
  const upNextOne = orderedActive[1] ?? null;

  // Get pack definition for current target
  const currentPackDef = useMemo(() => {
    if (!currentTarget) return null;
    const busyCodes = deriveBusyCodeCandidates(currentTarget.orderItem);
    for (const code of busyCodes) {
      const def = packDefinitionByBusyCode.get(code);
      if (def) return def;
    }
    return null;
  }, [currentTarget, packDefinitionByBusyCode]);

  const currentTargetProgress = useMemo(() => {
    if (!currentTarget) return null;
    const targetQty = pickQuantityTarget(currentTarget.orderItem);
    const pickedQty = Math.min(
      targetQty,
      getPickedQtyFromResult(currentTarget.scanResult),
    );
    return {
      targetQty,
      pickedQty,
      remainingQty: Math.max(0, targetQty - pickedQty),
    };
  }, [currentTarget]);

  // Pack breakdown for current target
  const currentBreakdown = useMemo(() => {
    if (!currentTargetProgress) return null;
    return computePackBreakdown(currentTargetProgress.targetQty, currentPackDef);
  }, [currentTargetProgress, currentPackDef]);

  const currentAliasForVerification = useMemo(() => {
    if (!currentTarget) return null;
    return (
      currentTarget.orderItem.catalog_alias1 ??
      currentTarget.orderItem.catalog_alias ??
      currentTarget.orderItem.item_alias ??
      null
    );
  }, [currentTarget]);

  // Render-time English description of the recommended pack split (e.g. "Pick 2
  // inner packs + 12 loose"). The tile breakdown stays as the secondary view.
  const currentSplitText = useMemo(
    () => describePackSplit(currentBreakdown, currentPackDef),
    [currentBreakdown, currentPackDef],
  );

  // The just-completed item we render during `celebrating` lives in `done`, not
  // `active`. Look it up so the green-dwell card can show its actual contents.
  const celebratingItem = useMemo(() => {
    if (!celebrating) return null;
    return order?.items.find((oi) => oi.id === celebrating.itemId) ?? null;
  }, [celebrating, order?.items]);

  // Group the trip-summary view's racks by rack_no so the brief reads as a route,
  // not a list of items. Items without a rack go into a "—" group at the end.
  const briefRacks = useMemo(() => {
    if (!order?.items) return [] as { rack: string | null; lines: number; pieces: number }[];
    const sorted = sortByRack(order.items);
    const map = new Map<string, { rack: string | null; lines: number; pieces: number }>();
    for (const item of sorted) {
      const key = item.rack_no ?? '—';
      const target = pickQuantityTarget(item);
      const entry = map.get(key) ?? { rack: item.rack_no ?? null, lines: 0, pieces: 0 };
      entry.lines += 1;
      entry.pieces += target;
      map.set(key, entry);
    }
    return [...map.values()];
  }, [order?.items]);

  const briefTotals = useMemo(() => {
    const lines = order?.items?.length ?? 0;
    const pieces = order?.items?.reduce((sum, oi) => sum + pickQuantityTarget(oi), 0) ?? 0;
    return { lines, pieces };
  }, [order?.items]);

  // Build the QueueSheet view-model in one place.
  const queueSheetRows: QueueSheetRow[] = useMemo(() => {
    const rows: QueueSheetRow[] = [];
    for (const pi of pickItems) {
      const isCurrent = currentTarget?.orderItem.id === pi.orderItem.id;
      const status: QueueSheetRow['status'] = isCurrent
        ? 'now'
        : pi.uiState === 'picked' || pi.uiState === 'overridden'
          ? 'picked'
          : pi.uiState === 'flagged'
            ? 'flagged'
            : skippedIds.has(pi.orderItem.id)
              ? 'skipped'
              : 'next';
      rows.push({
        itemId: pi.orderItem.id,
        rackNo: pi.orderItem.rack_no,
        itemCode: pi.orderItem.item_alias ?? null,
        itemName: pi.orderItem.item_name,
        targetQty: pickQuantityTarget(pi.orderItem),
        status,
      });
    }
    return rows;
  }, [pickItems, currentTarget, skippedIds]);

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

  const allDone = counts.remaining === 0 && counts.total > 0;
  const hasFlagged = counts.flagged > 0;
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
    void _reason; // reason currently surfaces via toast/log only.
    setSkippedIds((prev) => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
    appHaptics.impactLight();
    toast.info('Skipped — will return at the end of the queue.');
  }, [toast]);

  // ─── Long-press override for missing rack QRs ───
  // Hold the rack number for ~600ms when there's no QR on the shelf yet. The
  // delay is intentional: Norman's "deliberate confirmation" pattern.
  const rackPressTimerRef = useRef<number | null>(null);
  const rackPressedTargetRef = useRef<number | null>(null);

  const startRackLongPress = useCallback(
    (itemId: number) => {
      rackPressedTargetRef.current = itemId;
      if (rackPressTimerRef.current) window.clearTimeout(rackPressTimerRef.current);
      rackPressTimerRef.current = window.setTimeout(() => {
        if (rackPressedTargetRef.current === itemId) {
          markRackVerified(itemId, 'override');
        }
      }, RACK_LONG_PRESS_MS);
    },
    [markRackVerified],
  );

  const cancelRackLongPress = useCallback(() => {
    if (rackPressTimerRef.current) {
      window.clearTimeout(rackPressTimerRef.current);
      rackPressTimerRef.current = null;
    }
    rackPressedTargetRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (rackPressTimerRef.current) window.clearTimeout(rackPressTimerRef.current);
    };
  }, []);

  // ─── Phase derivation ───
  // Single source of truth for what we render. Order matters: complete > brief
  // > celebrating > awaiting_rack > verified.
  type PickPhase =
    | { kind: 'brief' }
    | { kind: 'awaiting_rack'; itemId: number }
    | { kind: 'verified'; itemId: number }
    | { kind: 'celebrating'; itemId: number }
    | { kind: 'complete' };

  const phase: PickPhase = useMemo(() => {
    if (!currentTarget) return { kind: 'complete' };
    // Show celebrating until the dwell expires, even when DB has already moved
    // the item to done. This is what gives the picker the 700ms "I won" beat.
    if (celebrating) return { kind: 'celebrating', itemId: celebrating.itemId };
    // Brief shows once per session per order, only on a clean start. Mid-pick
    // refreshes don't re-prompt because briefAcknowledged is in sessionStorage.
    if (!briefAcknowledged && counts.picked + counts.flagged === 0) {
      return { kind: 'brief' };
    }
    if (rackVerifiedIds.has(currentTarget.orderItem.id)) {
      return { kind: 'verified', itemId: currentTarget.orderItem.id };
    }
    return { kind: 'awaiting_rack', itemId: currentTarget.orderItem.id };
  }, [currentTarget, celebrating, briefAcknowledged, counts.picked, counts.flagged, rackVerifiedIds]);

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
      appHaptics.success();
      setShowComplete(true);
    },
    onError: () => {
      toast.error('Failed to complete order');
    },
  });

  const openLiveScan = useCallback(
    (orderItem: OrderItem, mode: 'rack' | 'item' = 'item') => {
      const current = localItems.get(orderItem.id);
      const fallbackState = current?.uiState ?? uiStateFromDb(orderItem);
      const fallbackScanResult = current?.scanResult ?? orderItem.scan_result;

      appHaptics.impactLight();
      setScannerMode(mode);
      setScannerHint(null);
      // Only flip to 'scanning' visually for item-mode scans. Rack scans should
      // not disturb the gate-1 layout — the picker is just verifying location.
      if (mode === 'item') {
        updateLocalItem(orderItem.id, { uiState: 'scanning' });
      }
      setLiveScanSession({
        orderItem,
        previousUiState: fallbackState,
        previousScanResult: fallbackScanResult,
      });
    },
    [localItems, updateLocalItem],
  );

  /**
   * Roll back the last completed line within the undo window. Restores both the
   * DB `state` and the prior `scan_result` (so progress, suggestedQty, etc. are
   * exactly as they were one tick before completion).
   */
  const revertLastPick = useCallback(async () => {
    const snapshot = undoSnapshot;
    if (!snapshot) return;
    setUndoSnapshot(null);
    setCelebrating(null);
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

  const closeLiveScan = useCallback(() => {
    setLiveScanSession((current) => {
      if (!current) return null;
      updateLocalItem(current.orderItem.id, {
        uiState: current.previousUiState,
        scanResult: current.previousScanResult,
      });
      return null;
    });
  }, [updateLocalItem]);

  const handleScanResolved = useCallback((scan: LiveQrScannerResolved) => {
    setLiveScanSession((current) => {
      if (!current) return null;
      const now = Date.now();
      if (
        lastScanMeta &&
        lastScanMeta.rawValue === scan.rawValue &&
        now - lastScanMeta.at < DUPLICATE_SCAN_WINDOW_MS
      ) {
        setScannerHint('Duplicate scan ignored. Keep moving to the next label.');
        return current;
      }
      setLastScanMeta({ rawValue: scan.rawValue, at: now });

      // ─── Rack-gate (gate 1) ───
      // Warehouses print a "license plate" on the bin: big location text plus
      // ITEM / pack QRs. Those payloads classify as sku|pack|lpn — not the
      // dedicated PASPL_RACK format. We accept:
      //   (a) rack-location QR (RACK:… / PASPL_RACK) matching rack_no;
      //   (b) ITEM or pack QR that matches this line (LiveQrScanner sets matchesPickItem);
      //   (c) any decoded token matching rack_no (location string inside the QR).
      if (scannerMode === 'rack') {
        const classified = classifyScanPayload(scan.rawValue);
        const expectedRack = current.orderItem.rack_no;

        let gateOk = false;
        if (classified.kind === 'rack' && classified.rackPayload) {
          const scannedCode = classified.rackPayload.rackCode;
          if (!rackCodesMatch(scannedCode, expectedRack)) {
            setScannerHint(
              `Wrong shelf — scanned ${scannedCode}, expected ${expectedRack ?? '—'}. Walk to the right rack.`,
            );
            appHaptics.warning();
            return current;
          }
          gateOk = true;
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
            expectedRack
              ? 'Scan the bin license plate: ITEM or pack QR for this product, or a location QR that matches this rack. If it still fails, check order rack_no matches the big code on the label.'
              : 'Scan the bin license plate (ITEM or pack QR) for this line.',
          );
          appHaptics.warning();
          return current;
        }

        markRackVerified(current.orderItem.id, 'scan');
        setScannerHint(null);
        updateLocalItem(current.orderItem.id, {
          uiState: current.previousUiState,
          scanResult: current.previousScanResult,
        });
        return null;
      }

      const targetQty = pickQuantityTarget(current.orderItem);
      if (targetQty <= 0) {
        const zeroQtyResult: ScanResult = {
          isMatch: false,
          confidence: 0,
          extractedCode: scan.lookupCode ?? undefined,
          extractedDescription: scan.matchedItem?.name ?? undefined,
          reason: 'Line has 0 target qty. Manual qty entry or flag is required.',
          scannedText: scan.rawValue,
          matchedAgainst: scan.matchedBy ?? current.orderItem.item_name,
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
        updateLocalItem(current.orderItem.id, {
          uiState: 'warning',
          scanResult: zeroQtyResult,
        });
        itemTransitionMutation.mutate({
          transition: {
            kind: 'scan_saved',
            itemId: current.orderItem.id,
            scanResult: zeroQtyResult,
          },
        });
        appHaptics.warning();
        setScannerHint('This line has target qty 0. Enter qty manually or flag it. It will not auto-skip.');
        return null;
      }
      const classified = classifyScanPayload(scan.rawValue);
      const lookupCandidates = classified.normalizedCandidates;
      const packPayload = parsePackPickPayload(scan.rawValue);
      const lpnPayload = parseLpnPickPayload(scan.rawValue);
      const busyCodeCandidates = deriveBusyCodeCandidates(current.orderItem);
      const packDefinitionByPayload = packPayload
        ? packDefinitionByBusyCode.get(packPayload.busyCode) ?? null
        : null;
      const packDefinitionByCurrentItem = packDefinitionByItemId.get(current.orderItem.item_id) ?? null;
      const payloadMatchesCurrentItem = Boolean(
        packPayload &&
          (
            busyCodeCandidates.includes(packPayload.busyCode) ||
            (packDefinitionByPayload?.item_id_snapshot != null &&
              packDefinitionByPayload.item_id_snapshot === current.orderItem.item_id) ||
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
        getPickedQtyFromResult(current.previousScanResult),
      );
      const remainingBeforeScan = Math.max(0, targetQty - existingPickedBefore);
      const suggestedQty =
        classified.kind === 'lpn' && Number.isFinite(lpnSuggested)
          ? Math.max(1, Number(lpnSuggested))
          : Number.isFinite(packQty) && (packQty ?? 0) > 0
            ? Number(packQty)
            : classified.extractedQuantity && classified.extractedQuantity > 0
              ? classified.extractedQuantity
              : 1;
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
            ? `Pack scan (${packPayload?.packType}) suggests ${suggestedQty} units. Confirm break-pack for target ${targetQty}.`
            : `Pack scan (${packPayload?.packType}) verified for ${suggestedQty} units.`
          : classified.kind === 'lpn'
            ? `LPN scan ${lpnPayload?.lpnCode ?? ''} suggests ${suggestedQty} units.`
          : scan.reason,
        scannedText: scan.rawValue,
        matchedAgainst: scan.matchedBy ?? current.orderItem.item_name,
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

      updateLocalItem(current.orderItem.id, {
        uiState,
        scanResult: result,
      });

      if (!result.isMatch || requiresManualQtyConfirmation) {
        itemTransitionMutation.mutate({
          transition: {
            kind: 'scan_saved',
            itemId: current.orderItem.id,
            scanResult: result,
          },
        });
      }

      if (requiresManualQtyConfirmation) {
        setPendingPackConfirmation({
          orderItemId: current.orderItem.id,
          scanResult: result,
          suggestedQty,
          targetQty: remainingBeforeScan,
        });
      }

      if (result.isMatch && !requiresManualQtyConfirmation) {
        const nextPicked = Math.min(targetQty, existingPickedBefore + suggestedQty);
        const nextRemaining = Math.max(0, targetQty - nextPicked);
        const progressedResult: ScanResult = {
          ...result,
          progress: {
            pickedQty: nextPicked,
            remainingQty: nextRemaining,
            targetQty,
          },
        };
        updateLocalItem(current.orderItem.id, {
          scanResult: progressedResult,
          uiState: nextRemaining === 0 ? 'picked' : 'matched',
        });
        itemTransitionMutation.mutate({
          transition: {
            kind: 'scan_saved',
            itemId: current.orderItem.id,
            scanResult: progressedResult,
          },
        });
        if (nextRemaining === 0) {
          itemTransitionMutation.mutate({
            transition: {
              kind: 'picked',
              itemId: current.orderItem.id,
              scanResult: progressedResult,
            },
            optimisticState: 'picked',
          });
          // Mirror applyPickedQty: snapshot for undo + start the green dwell so
          // the auto-advance lands on the next stop with motion, not a jump cut.
          setUndoSnapshot({
            itemId: current.orderItem.id,
            itemName: current.orderItem.item_name,
            itemCode: current.orderItem.item_alias ?? null,
            previousScanResult: current.previousScanResult,
            previousState: 'pending',
            expiresAt: Date.now() + UNDO_DURATION_MS,
          });
          setCelebrating({
            itemId: current.orderItem.id,
            expiresAt: Date.now() + CELEBRATE_DURATION_MS,
          });
        }
        appHaptics.success();
        setScannerHint(
          nextRemaining === 0
            ? `Completed ${current.orderItem.item_name}.`
            : `Matched ${classified.kind.toUpperCase()} scan. ${nextRemaining} remaining.`,
        );
      } else {
        appHaptics.warning();
      }

      return result.isMatch ? null : current;
    });
  }, [
    lastScanMeta,
    itemTransitionMutation,
    markRackVerified,
    packDefinitionByBusyCode,
    packDefinitionByItemId,
    scannerMode,
    updateLocalItem,
    userId,
    userName,
  ]);

  const applyPickedQty = useCallback(
    (itemId: number, qtyToApply: number) => {
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
      const manualScanResult: ScanResult = local?.scanResult ?? {
        scannedText: 'MANUAL_PICK',
        confidence: 100,
        isMatch: true,
        matchedAgainst: 'manual',
        matchStrategy: 'manual_pick',
        ocrExtracted: { partNumber: null, mrp: null },
        method: 'manual',
        timestamp: new Date().toISOString(),
        reason: 'Manual pick confirmation',
        operatorContext: {
          pickerName: userName,
          pickerUserId: userId,
          source: 'manual',
        },
      };
      const progressedResult: ScanResult = {
        ...manualScanResult,
        suggestedQty: Math.floor(qtyToApply),
        progress: {
          pickedQty: nextPicked,
          remainingQty: nextRemaining,
          targetQty,
        },
      };
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
        // Capture rollback data BEFORE the mutation flushes, so undo restores
        // the exact pre-completion state (scan_result + 'pending' state).
        setUndoSnapshot({
          itemId,
          itemName: orderItem.item_name,
          itemCode: orderItem.item_alias ?? null,
          previousScanResult,
          previousState,
          expiresAt: Date.now() + UNDO_DURATION_MS,
        });
        // Hold on the green dwell so the picker sees the win. The next stop's
        // card slides in once `celebrating` clears.
        setCelebrating({
          itemId,
          expiresAt: Date.now() + CELEBRATE_DURATION_MS,
        });
        appHaptics.success();
      }
    },
    [itemTransitionMutation, localItems, order?.items, toast, updateLocalItem, userId, userName],
  );

  const handlePick = useCallback(
    (itemId: number) => {
      applyPickedQty(itemId, 1);
    },
    [applyPickedQty],
  );

  const handleOverride = useCallback(
    (itemId: number) => {
      appHaptics.impactMedium();
      updateLocalItem(itemId, { uiState: 'overridden' });
      const local = localItems.get(itemId);
      const manualScanResult: ScanResult = local?.scanResult ?? {
        scannedText: 'MANUAL_OVERRIDE',
        confidence: 70,
        isMatch: false,
        matchedAgainst: 'manual',
        matchStrategy: 'manual_override',
        ocrExtracted: { partNumber: null, mrp: null },
        method: 'manual',
        timestamp: new Date().toISOString(),
        reason: 'Picker override after scan mismatch',
        operatorContext: {
          pickerName: userName,
          pickerUserId: userId,
          source: 'manual',
        },
      };
      itemTransitionMutation.mutate({
        transition: {
          kind: 'picked',
          itemId,
          scanResult: manualScanResult,
        },
        optimisticState: 'overridden',
      });
    },
    [updateLocalItem, itemTransitionMutation, localItems, userId, userName],
  );

  const handleFlag = useCallback(() => {
    if (!flagTarget || !flagReason) return;

    if (flagReason === 'Price Mismatch') {
      const raw = flagBoxPrice.trim();
      if (!raw) {
        toast.error('Please enter the price printed on the box');
        return;
      }
      const normalized = raw.replace(/,/g, '');
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast.error('Please enter a valid box price');
        return;
      }
      appHaptics.impactMedium();
      itemTransitionMutation.mutate({
        transition: {
          kind: 'flagged',
          itemId: flagTarget,
          reason: flagReason,
          notes: buildPriceMismatchNotes(flagNotes, parsed),
          boxPrice: parsed,
          scanResult: localItems.get(flagTarget)?.scanResult ?? null,
        },
        optimisticState: 'flagged',
      });
      setFlagTarget(null);
      setFlagReason('');
      setFlagNotes('');
      setFlagBoxPrice('');
      return;
    }

    appHaptics.impactMedium();
    itemTransitionMutation.mutate({
      transition: {
        kind: 'flagged',
        itemId: flagTarget,
        reason: flagReason,
        notes: flagNotes.trim() || null,
        boxPrice: null,
        scanResult: localItems.get(flagTarget)?.scanResult ?? null,
      },
      optimisticState: 'flagged',
    });
    setFlagTarget(null);
    setFlagReason('');
    setFlagNotes('');
    setFlagBoxPrice('');
  }, [
    flagTarget,
    flagReason,
    flagNotes,
    flagBoxPrice,
    itemTransitionMutation,
    localItems,
    toast,
  ]);

  if (!orderId) {
    navigate('/picking');
    return null;
  }

  if (showComplete && order) {
    return (
      <PickCompleteScreen
        orderNumber={order.order_number}
        customerName={order.customer_name}
        pickedCount={counts.picked}
        flaggedCount={counts.flagged}
        totalCount={counts.total}
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

  const isVerified = phase.kind === 'verified';
  const isAwaitingRack = phase.kind === 'awaiting_rack';
  const isCelebrating = phase.kind === 'celebrating';
  const isBriefPhase = phase.kind === 'brief';
  // Stable key drives the slide-in animation when the active stop changes.
  const heroKey = isCelebrating
    ? `celebrate-${celebrating?.itemId ?? 0}`
    : currentTarget
      ? `pick-${currentTarget.orderItem.id}`
      : 'empty';

  return (
    <div className="min-h-screen pb-32">
      {/* Header — order summary + global progress.
          Audit chips were removed from here on purpose: pickers don't need to
          read 'Pack-assisted: 3' while walking. They live in the Queue sheet now. */}
      <header className="sticky top-0 z-40 bg-[var(--bg-primary)]/90 backdrop-blur-md px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/picking')}
            className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-[var(--content-secondary)] pick-pressable"
          >
            <CaretLeft size={24} weight="bold" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-lg text-[var(--content-primary)]">
                {order.order_number}
              </span>
              {order.priority === 'urgent' && <StatusBadge status="urgent" />}
            </div>
            <p className="text-sm text-[var(--content-tertiary)] truncate">
              {order.customer_name}
              {order.transport_name && ` · ${order.transport_name}`}
            </p>
          </div>
          <div className="text-right shrink-0 tabular-nums">
            <p className="text-2xl font-bold text-[var(--content-primary)]">
              {counts.picked + counts.flagged}
              <span className="text-[var(--content-tertiary)] text-base font-normal">
                /{counts.total}
              </span>
            </p>
          </div>
        </div>

        <ProgressBar
          segments={[
            { value: counts.picked, color: 'green' },
            { value: counts.flagged, color: 'red' },
            { value: counts.remaining, color: 'gray' },
          ]}
          total={counts.total}
        />
      </header>

      <div className="px-4 pt-3 space-y-4">
        {isBriefPhase ? (
          /* ─── Order Brief: trip summary before walking the route ─── */
          <div className="space-y-4 animate-pick-stop-enter">
            <div className="ds-card p-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                Trip summary
              </p>
              <h2 className="text-xl font-bold text-[var(--content-primary)] mt-1">
                {order.customer_name}
              </h2>
              {order.transport_name && (
                <p className="text-sm text-[var(--content-secondary)] mt-0.5">
                  {order.transport_name}
                </p>
              )}
              <div className="grid grid-cols-3 gap-2 mt-4">
                <div className="rounded-xl bg-[var(--bg-tertiary)] px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                    Lines
                  </p>
                  <p className="font-mono font-bold text-2xl text-[var(--content-primary)] leading-tight tabular-nums">
                    {briefTotals.lines}
                  </p>
                </div>
                <div className="rounded-xl bg-[var(--bg-tertiary)] px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                    Pieces
                  </p>
                  <p className="font-mono font-bold text-2xl text-[var(--content-primary)] leading-tight tabular-nums">
                    {briefTotals.pieces}
                  </p>
                </div>
                <div className="rounded-xl bg-[var(--bg-tertiary)] px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                    Racks
                  </p>
                  <p className="font-mono font-bold text-2xl text-[var(--content-primary)] leading-tight tabular-nums">
                    {briefRacks.length}
                  </p>
                </div>
              </div>
            </div>

            <div className="ds-card p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] mb-2">
                Route — in pick order
              </p>
              <div className="space-y-1.5">
                {briefRacks.map((r, idx) => (
                  <div
                    key={`${r.rack ?? 'norack'}-${idx}`}
                    className="flex items-center gap-3 py-1.5 border-b border-[var(--border-faint)] last:border-0"
                  >
                    <span className="w-6 h-6 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-[10px] font-semibold text-[var(--content-tertiary)] shrink-0 tabular-nums">
                      {idx + 1}
                    </span>
                    <MapPin size={14} weight="regular" className="text-[var(--content-tertiary)] shrink-0" />
                    <span className="font-mono font-bold text-sm text-[var(--content-primary)] min-w-16">
                      {r.rack ?? '—'}
                    </span>
                    <span className="text-xs text-[var(--content-tertiary)] flex-1">
                      {r.lines} line{r.lines === 1 ? '' : 's'}
                    </span>
                    <span className="font-mono text-xs font-semibold text-[var(--content-secondary)] tabular-nums">
                      {r.pieces} pcs
                    </span>
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
        ) : isCelebrating && celebratingItem ? (
          /* ─── Celebrating: 700ms green dwell on the just-completed item ─── */
          <div
            key={heroKey}
            className="ds-card p-6 bg-[var(--bg-positive-subtle)] border-2 border-[var(--border-positive)] animate-pick-celebrate"
          >
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-16 h-16 rounded-full bg-[var(--bg-positive)] flex items-center justify-center">
                <Check size={32} weight="bold" className="text-[var(--content-on-color)]" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-positive)]">
                  Picked
                </p>
                <p className="font-mono font-bold text-base text-[var(--content-primary)] mt-0.5">
                  {celebratingItem.item_alias ?? celebratingItem.item_id}
                </p>
                <p className="text-sm text-[var(--content-secondary)] mt-0.5 line-clamp-2">
                  {celebratingItem.item_name}
                </p>
              </div>
            </div>
          </div>
        ) : currentTarget ? (
          <>
            {/* ─── HERO STOP ─── Either gate-1 (awaiting rack) or gate-2 (verified). */}
            <div
              key={heroKey}
              className={`ds-card p-4 animate-pick-stop-enter ${
                isVerified ? 'ring-1 ring-[var(--border-positive)]' : ''
              }`}
            >
              {/* Item header with SKU + position counter */}
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-[var(--border-faint)]">
                <div className="min-w-0 flex-1">
                  <p className="font-mono font-bold text-sm text-[var(--content-primary)]">
                    {currentTarget.orderItem.item_alias ?? currentTarget.orderItem.item_id}
                  </p>
                  <p className="text-[var(--content-secondary)] text-sm mt-0.5 line-clamp-2">
                    {currentTarget.orderItem.item_name}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-[var(--bg-tertiary)] text-[var(--content-tertiary)] shrink-0 tabular-nums">
                  {counts.picked + counts.flagged + 1} of {counts.total}
                </span>
              </div>

              {/* Rack number — always huge.
                  Long-press on the rack to override-verify when no QR is on the
                  shelf yet. The press needs to be deliberate (600ms) to avoid
                  accidental bypass. */}
              <button
                type="button"
                onPointerDown={() => startRackLongPress(currentTarget.orderItem.id)}
                onPointerUp={cancelRackLongPress}
                onPointerLeave={cancelRackLongPress}
                onPointerCancel={cancelRackLongPress}
                className={`mt-4 w-full text-left rounded-2xl p-4 transition-colors duration-200 pick-pressable ${
                  isAwaitingRack
                    ? 'bg-[var(--bg-tertiary)] border-2 border-dashed border-[var(--border-opaque)]'
                    : 'bg-[var(--bg-positive-subtle)] border-2 border-[var(--border-positive)]'
                }`}
                aria-label="Rack location. Long press to mark verified without scanning."
              >
                <div className="flex items-center gap-2">
                  <MapPin
                    size={18}
                    weight="fill"
                    className={
                      isAwaitingRack
                        ? 'text-[var(--content-tertiary)]'
                        : 'text-[var(--content-positive)]'
                    }
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                    {isAwaitingRack ? 'Walk to rack' : 'Verified rack'}
                  </span>
                  {isVerified && (
                    <Check size={14} weight="bold" className="text-[var(--content-positive)] ml-auto" />
                  )}
                </div>
                <p className="font-mono font-bold text-[64px] leading-none mt-1 text-[var(--content-primary)]">
                  {currentTarget.orderItem.rack_no ?? '—'}
                </p>
                {isAwaitingRack && (
                  <p className="text-[11px] text-[var(--content-tertiary)] mt-2">
                    Hold to verify without scanning if the label won’t scan
                  </p>
                )}
              </button>

              {/* Qty + pack split.
                  Veiled (blur + dim) until rack-verified. Norman: a constraint
                  that prevents picking from the wrong shelf — you can sense the
                  content exists but can't act on it yet. */}
              <div
                className={`pt-4 transition-all duration-200 ${
                  isAwaitingRack ? 'opacity-55' : 'animate-pick-veil-reveal'
                }`}
                style={isAwaitingRack ? { filter: 'blur(6px)' } : undefined}
                aria-hidden={isAwaitingRack}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] mb-1">
                  Remaining qty
                </p>
                <div className="flex items-baseline gap-1 tabular-nums">
                  <span className="font-mono font-bold text-[52px] leading-none text-[var(--content-primary)] transition-opacity duration-150">
                    {currentTargetProgress?.remainingQty ?? 0}
                  </span>
                  <span className="text-sm font-medium text-[var(--content-tertiary)]">pcs</span>
                </div>
                {currentTargetProgress && (
                  <p className="text-xs text-[var(--content-secondary)] mt-1 tabular-nums">
                    Picked {currentTargetProgress.pickedQty} of {currentTargetProgress.targetQty}
                  </p>
                )}
                {currentSplitText.text && currentSplitText.hasMultipleTiers && (
                  <p className="text-sm font-semibold text-[var(--content-primary)] mt-2">
                    {currentSplitText.text}
                  </p>
                )}
                {currentTargetProgress?.targetQty === 0 && (
                  <div className="mt-2 rounded-lg border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-3 py-2">
                    <p className="text-xs font-semibold text-[var(--content-warning-on-light)]">
                      Qty target is 0. This line will not auto-complete.
                    </p>
                    <p className="text-[11px] text-[var(--content-warning-on-light)] mt-0.5">
                      Use Enter qty for bulk/manual picking or Flag to route for review.
                    </p>
                  </div>
                )}

                {/* Tile breakdown — secondary visual, supports the English line above. */}
                {currentBreakdown && (currentBreakdown.hasOuter || currentBreakdown.hasInner) && (
                  <div className="flex gap-2 mt-3">
                    {currentBreakdown.hasOuter && (
                      <div
                        className={`flex-1 rounded-xl p-2.5 border-[1.5px] bg-[var(--bg-accent-subtle)] border-[var(--border-accent)] ${
                          currentBreakdown.outerQty === 0 ? 'opacity-35' : ''
                        }`}
                      >
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--content-accent)]">Master</p>
                        <p className="font-mono font-bold text-[26px] leading-none text-[var(--content-accent)] tabular-nums">
                          {currentBreakdown.outerQty}
                        </p>
                        <p className="text-[9px] font-medium text-[var(--content-accent)]">
                          ×{currentPackDef?.outer_pack_qty ?? 0} ea
                        </p>
                      </div>
                    )}
                    {currentBreakdown.hasInner && (
                      <div
                        className={`flex-1 rounded-xl p-2.5 border-[1.5px] bg-[var(--bg-positive-subtle)] border-[var(--border-positive)] ${
                          currentBreakdown.innerQty === 0 ? 'opacity-35' : ''
                        }`}
                      >
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--content-positive)]">Inner</p>
                        <p className="font-mono font-bold text-[26px] leading-none text-[var(--content-positive)] tabular-nums">
                          {currentBreakdown.innerQty}
                        </p>
                        <p className="text-[9px] font-medium text-[var(--content-positive)]">
                          ×{currentPackDef?.inner_pack_qty ?? 0} = {currentBreakdown.innerPcs}
                        </p>
                      </div>
                    )}
                    <div
                      className={`flex-1 rounded-xl p-2.5 border-[1.5px] bg-[var(--bg-tertiary)] border-[var(--border-subtle)] ${
                        currentBreakdown.looseQty === 0 ? 'opacity-35' : ''
                      }`}
                    >
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">Loose</p>
                      <p className="font-mono font-bold text-[26px] leading-none text-[var(--content-secondary)] tabular-nums">
                        {currentBreakdown.looseQty}
                      </p>
                      <p className="text-[9px] font-medium text-[var(--content-tertiary)]">
                        + {currentBreakdown.looseQty} pcs
                      </p>
                    </div>
                  </div>
                )}

                {/* Label-verify chip — shown only when verified. The picker eyes
                    this against the printed alias on the box before scanning. */}
                {isVerified && currentAliasForVerification && (
                  <div className="mt-3 rounded-lg border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-accent)]">
                      Box label (Alias 1)
                    </p>
                    <p className="font-mono text-base font-bold text-[var(--content-primary)] leading-tight break-all">
                      {currentAliasForVerification}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ─── ACTIONS ─── different per phase. */}
            {isAwaitingRack ? (
              <div className="space-y-2">
                <BigButton
                  variant="primary"
                  onClick={() => openLiveScan(currentTarget.orderItem, 'rack')}
                  className="bg-[var(--bg-inverse-primary)] text-[var(--content-on-color)]"
                >
                  <Camera size={20} weight="bold" />
                  Scan bin label to unlock pick
                </BigButton>
                {scannerHint && (
                  <p className="text-xs text-[var(--content-secondary)] bg-[var(--bg-tertiary)] rounded-lg px-3 py-2">
                    {scannerHint}
                  </p>
                )}
              </div>
            ) : (
              /* Verified — full pick action set. The tier rows live inside the
                 scanner sheet when scanning is active; here we keep the surface
                 clean so the picker can either tap "Scan box" or use manual. */
              <div className="space-y-3">
                <BigButton
                  variant="primary"
                  onClick={() => openLiveScan(currentTarget.orderItem, 'item')}
                  className="bg-[var(--bg-inverse-primary)] text-[var(--content-on-color)]"
                >
                  <Camera size={20} weight="bold" />
                  Scan box / pack
                </BigButton>

                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => handlePick(currentTarget.orderItem.id)}
                    className="h-11 rounded-xl bg-[var(--bg-tertiary)] text-sm font-medium text-[var(--content-secondary)] pick-pressable"
                  >
                    +1 manual
                  </button>
                  <button
                    onClick={() => {
                      setManualQtyTargetItemId(currentTarget.orderItem.id);
                      setManualQtyInput('1');
                    }}
                    className="h-11 rounded-xl bg-[var(--bg-accent-subtle)] text-sm font-medium text-[var(--content-accent)] pick-pressable"
                  >
                    Enter qty
                  </button>
                  <button
                    onClick={() => handleOverride(currentTarget.orderItem.id)}
                    className="h-11 rounded-xl bg-[var(--bg-warning-subtle)] text-sm font-medium text-[var(--content-warning)] pick-pressable"
                  >
                    Override
                  </button>
                  <button
                    onClick={() => {
                      setFlagTarget(currentTarget.orderItem.id);
                      setFlagReason('');
                      setFlagNotes('');
                      setFlagBoxPrice('');
                    }}
                    className="h-11 rounded-xl bg-[var(--bg-negative-subtle)] text-sm font-medium text-[var(--content-negative)] pick-pressable"
                  >
                    Flag
                  </button>
                </div>

                {scannerHint && (
                  <p className="text-xs text-[var(--content-secondary)] bg-[var(--bg-tertiary)] rounded-lg px-3 py-2">
                    {scannerHint}
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="ds-card p-6 text-center">
            <div className="w-14 h-14 bg-[var(--bg-positive-subtle)] rounded-full flex items-center justify-center mx-auto mb-3">
              <CheckCircle size={28} weight="fill" className="text-[var(--content-positive)]" />
            </div>
            <p className="font-semibold text-[var(--content-primary)]">All items processed</p>
            <p className="text-sm text-[var(--content-tertiary)] mt-1">
              {counts.picked} picked, {counts.flagged} flagged
            </p>
          </div>
        )}

        {/* ─── Up-next peek + queue handle ───
            One peek line is enough to satisfy "what's coming?" without breaking
            focus on the current pick. Tap the handle/peek to open the full
            queue sheet (drag handle inside the sheet itself dismisses it). */}
        {!isBriefPhase && (currentTarget || done.length > 0) && (
          <button
            type="button"
            onClick={() => {
              appHaptics.selection();
              setQueueSheetOpen(true);
            }}
            className="w-full rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-4 py-3 pick-pressable text-left"
            aria-label="Open pick queue"
          >
            <div className="flex justify-center mb-1.5">
              <span className="block w-9 h-1 rounded-full bg-[var(--border-opaque)]" />
            </div>
            {upNextOne ? (
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] shrink-0">
                  Next
                </span>
                <span className="font-mono font-bold text-xs text-[var(--content-primary)] min-w-12 shrink-0">
                  {upNextOne.orderItem.rack_no ?? '—'}
                </span>
                <span className="font-mono text-xs text-[var(--content-secondary)] truncate flex-1">
                  {upNextOne.orderItem.item_alias ?? upNextOne.orderItem.item_name}
                </span>
                <span className="font-mono text-xs text-[var(--content-tertiary)] shrink-0 tabular-nums">
                  ×{pickQuantityTarget(upNextOne.orderItem)}
                </span>
                <ListChecks size={16} weight="regular" className="text-[var(--content-tertiary)] shrink-0" />
              </div>
            ) : (
              <div className="flex items-center gap-2 justify-center text-[var(--content-tertiary)] text-xs">
                <ArrowUp size={14} weight="regular" />
                View queue
              </div>
            )}
          </button>
        )}
      </div>

      {/* Complete button */}
      {allDone && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-[var(--bg-primary)] border-t border-[var(--border-subtle)] space-y-3">
          {/* Summary receipt */}
          <div className="bg-[var(--bg-tertiary)] rounded-xl p-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[var(--content-tertiary)]">Items picked</span>
              <span className="font-mono font-bold text-[var(--content-positive)]">
                {counts.picked}
              </span>
            </div>
            {counts.flagged > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-[var(--content-tertiary)]">Items flagged</span>
                <span className="font-mono font-bold text-[var(--content-negative)]">
                  {counts.flagged}
                </span>
              </div>
            )}
            <div className="flex justify-between text-sm pt-2 border-t border-[var(--border-faint)]">
              <span className="text-[var(--content-secondary)] font-medium">Total confirmed</span>
              <span className="font-mono font-bold text-[var(--content-primary)]">
                {counts.total} items
              </span>
            </div>
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
                Complete with {counts.flagged} Flagged
              </>
            ) : (
              <>
                <ArrowRight size={20} weight="bold" />
                Complete Order
              </>
            )}
          </BigButton>
        </div>
      )}

      {/* Flag bottom sheet */}
      <BottomSheet
        isOpen={flagTarget !== null}
        onClose={() => setFlagTarget(null)}
        title="Flag Item"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--content-tertiary)]">
            Select a reason for flagging this item:
          </p>
          <div className="grid grid-cols-2 gap-2">
            {FLAG_REASONS.map((reason) => (
              <button
                key={reason}
                onClick={() => setFlagReason(reason)}
                className={`
                  px-3 py-3 rounded-xl text-sm font-medium text-left
                  transition-colors duration-150 min-h-12
                  ${
                    flagReason === reason
                      ? 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] ring-1 ring-[var(--border-negative)]'
                      : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
                  }
                `}
              >
                {reason}
              </button>
            ))}
          </div>
          {flagReason === 'Price Mismatch' && (
            <div className="space-y-1">
              <p className="text-xs text-[var(--content-secondary)]">
                Enter the price printed on the box. Billing will see this and can adjust the invoice.
              </p>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--content-tertiary)]">
                  ₹
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={flagBoxPrice}
                  onChange={(e) => setFlagBoxPrice(e.target.value)}
                  placeholder="Box price"
                  className="
                    w-full pl-7 pr-3 py-3 rounded-xl
                    bg-[var(--bg-tertiary)] text-[var(--content-primary)]
                    placeholder-[var(--content-disabled)]
                    border border-[var(--border-subtle)]
                    focus:outline-none focus:ring-2 focus:ring-[var(--border-negative)]
                  "
                />
              </div>
            </div>
          )}
          <textarea
            value={flagNotes}
            onChange={(e) => setFlagNotes(e.target.value)}
            placeholder="Additional notes (optional)"
            className="
              w-full h-20 px-4 py-3 rounded-xl
              bg-[var(--bg-tertiary)] text-[var(--content-primary)]
              placeholder-[var(--content-disabled)]
              border border-[var(--border-subtle)]
              focus:outline-none focus:ring-2 focus:ring-[var(--border-negative)]
            "
          />
          <BigButton
            variant="primary"
            onClick={handleFlag}
            disabled={
              !flagReason ||
              (flagReason === 'Price Mismatch' && !flagBoxPrice.trim())
            }
            loading={itemTransitionMutation.isPending}
            className="bg-[var(--bg-negative)] text-[var(--content-on-color)]"
          >
            <Flag size={18} weight="fill" />
            Flag Item
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
                  applyPickedQty(pending.orderItemId, pending.suggestedQty);
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
                  setManualQtyInput(String(Math.max(1, pending.targetQty)));
                }}
                className="flex-1 bg-[var(--bg-accent)] text-[var(--content-on-color)]"
              >
                Enter Manually
              </BigButton>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        isOpen={manualQtyTargetItemId !== null}
        onClose={() => setManualQtyTargetItemId(null)}
        title="Enter Picked Qty"
      >
        {manualQtyTargetItemId !== null && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--content-secondary)]">
              For bulk lines without inner packs, enter the quantity picked in this action.
            </p>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={manualQtyInput}
              onChange={(e) => setManualQtyInput(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3 text-[var(--content-primary)]"
              placeholder="Enter qty"
            />
            <BigButton
              variant="primary"
              onClick={() => {
                const parsed = Number(manualQtyInput);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                  toast.error('Enter a valid quantity');
                  return;
                }
                applyPickedQty(manualQtyTargetItemId, Math.floor(parsed));
                setManualQtyTargetItemId(null);
                setManualQtyInput('1');
              }}
              className="bg-[var(--bg-accent)] text-[var(--content-on-color)]"
            >
              Apply Picked Qty
            </BigButton>
          </div>
        )}
      </BottomSheet>

      {/* Queue sheet — opens via the peek-handle below the hero card. */}
      <QueueSheet
        isOpen={queueSheetOpen}
        onClose={() => setQueueSheetOpen(false)}
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
        currentItemId={currentTarget?.orderItem.id ?? null}
        onSkipItem={(itemId, reason) => {
          skipItem(itemId, reason);
          setQueueSheetOpen(false);
        }}
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

      {liveScanSession && (
        <LiveQrScanner
          title={
            scannerMode === 'rack'
              ? `Scan rack ${liveScanSession.orderItem.rack_no ?? ''}`.trim()
              : liveScanSession.orderItem.item_name
          }
          pickItem={{
            itemId: liveScanSession.orderItem.item_id,
            name: liveScanSession.orderItem.item_name,
            alias1: liveScanSession.orderItem.catalog_alias1 ?? null,
            alias: liveScanSession.orderItem.catalog_alias ?? null,
            itemCode: liveScanSession.orderItem.item_alias ?? null,
            busyCode: deriveBusyCodeCandidates(liveScanSession.orderItem)[0] ?? null,
          }}
          onClose={closeLiveScan}
          onResolved={handleScanResolved}
          onError={(message) => {
            if (!isBenignScannerAbort(message)) {
              toast.error(message);
            }
            closeLiveScan();
          }}
        />
      )}
    </div>
  );
}
