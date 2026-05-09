import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  Flag,
  CaretLeft,
  Warning,
  Camera,
  MapPin,
  Package,
  Cube,
  StackSimple,
  ArrowRight,
  Check,
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
import type { OrderItem, ScanResult } from '../../types';
import { FLAG_REASONS, type FlagReason } from '../../utils/constants';
import { PickCompleteScreen } from './PickCompleteScreen';
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

type ScanTier = 'outer' | 'inner' | 'loose';
type TierState = 'waiting' | 'active' | 'done';

interface TierProgress {
  tier: ScanTier;
  label: string;
  icon: React.ComponentType<{
    size?: number;
    weight?: 'fill' | 'regular' | 'bold';
    className?: string;
  }>;
  target: number;
  scanned: number;
  state: TierState;
  packSize: number;
}

function computeTierProgress(
  breakdown: PackBreakdown,
  pickedQty: number,
  packDef: ItemPackDefinition | null | undefined,
): TierProgress[] {
  const outerSize = packDef?.outer_pack_qty ?? 0;
  const innerSize = packDef?.inner_pack_qty ?? 0;

  const tiers: TierProgress[] = [];
  let remaining = pickedQty;

  // Outer tier
  if (breakdown.hasOuter && breakdown.outerQty > 0) {
    const outerScanned = Math.min(breakdown.outerQty, Math.floor(remaining / outerSize));
    remaining -= outerScanned * outerSize;
    tiers.push({
      tier: 'outer',
      label: 'Master box',
      icon: Package,
      target: breakdown.outerQty,
      scanned: outerScanned,
      state: outerScanned >= breakdown.outerQty ? 'done' : tiers.length === 0 ? 'active' : 'waiting',
      packSize: outerSize,
    });
  }

  // Inner tier
  if (breakdown.hasInner && breakdown.innerQty > 0) {
    const innerScanned = Math.min(breakdown.innerQty, Math.floor(remaining / innerSize));
    remaining -= innerScanned * innerSize;
    const outerDone = !tiers.length || tiers[0].state === 'done';
    tiers.push({
      tier: 'inner',
      label: 'Inner box',
      icon: Cube,
      target: breakdown.innerQty,
      scanned: innerScanned,
      state: innerScanned >= breakdown.innerQty ? 'done' : outerDone ? 'active' : 'waiting',
      packSize: innerSize,
    });
  }

  // Loose tier
  if (breakdown.looseQty > 0) {
    const looseScanned = Math.min(breakdown.looseQty, remaining);
    const priorDone = tiers.every((t) => t.state === 'done');
    tiers.push({
      tier: 'loose',
      label: 'Loose piece',
      icon: StackSimple,
      target: breakdown.looseQty,
      scanned: looseScanned,
      state: looseScanned >= breakdown.looseQty ? 'done' : priorDone ? 'active' : 'waiting',
      packSize: 1,
    });
  }

  // If no pack definitions exist, show a single loose tier
  if (tiers.length === 0) {
    const looseTarget = breakdown.totalPcs;
    const looseScanned = Math.min(looseTarget, pickedQty);
    tiers.push({
      tier: 'loose',
      label: 'Pieces',
      icon: StackSimple,
      target: looseTarget,
      scanned: looseScanned,
      state: looseScanned >= looseTarget ? 'done' : 'active',
      packSize: 1,
    });
  }

  return tiers;
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
  const orderItems = order?.items;

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
  const currentTarget = active[0] ?? null;
  const upNext = active.slice(1, 5);

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

  // Tier progress for scanning state
  const currentTiers = useMemo(() => {
    if (!currentBreakdown || !currentTargetProgress) return [];
    return computeTierProgress(
      currentBreakdown,
      currentTargetProgress.pickedQty,
      currentPackDef,
    );
  }, [currentBreakdown, currentTargetProgress, currentPackDef]);

  // Active tier for scanner hint
  const activeTier = useMemo(
    () => currentTiers.find((t) => t.state === 'active') ?? null,
    [currentTiers],
  );

  const totalScansTotal = useMemo(() => {
    return currentTiers.reduce((sum, t) => sum + t.target, 0);
  }, [currentTiers]);

  const totalScansDone = useMemo(() => {
    return currentTiers.reduce((sum, t) => sum + t.scanned, 0);
  }, [currentTiers]);

  const currentAliasForVerification = useMemo(() => {
    if (!currentTarget) return null;
    return (
      currentTarget.orderItem.catalog_alias1 ??
      currentTarget.orderItem.catalog_alias ??
      currentTarget.orderItem.item_alias ??
      null
    );
  }, [currentTarget]);

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

  const openLiveScan = useCallback((orderItem: OrderItem) => {
    const current = localItems.get(orderItem.id);
    const fallbackState = current?.uiState ?? uiStateFromDb(orderItem);
    const fallbackScanResult = current?.scanResult ?? orderItem.scan_result;

    appHaptics.impactLight();
    updateLocalItem(orderItem.id, { uiState: 'scanning' });
    setLiveScanSession({
      orderItem,
      previousUiState: fallbackState,
      previousScanResult: fallbackScanResult,
    });
  }, [localItems, updateLocalItem]);

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
      const targetQty = pickQuantityTarget(current.orderItem);
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
    packDefinitionByBusyCode,
    packDefinitionByItemId,
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
      const existingPicked = Math.min(
        targetQty,
        getPickedQtyFromResult(local?.scanResult ?? orderItem.scan_result),
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
      }
    },
    [itemTransitionMutation, localItems, order?.items, updateLocalItem, userId, userName],
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

  return (
    <div className="min-h-screen pb-32">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[var(--bg-primary)]/90 backdrop-blur-md px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/picking')}
            className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-[var(--content-secondary)]"
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
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold tabular-nums text-[var(--content-primary)]">
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
        <div className="flex flex-wrap gap-2 text-[11px] text-[var(--content-tertiary)]">
          <span className="px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)]">
            Pack-assisted: {visibility.packAssisted}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)]">
            Manual: {visibility.manual}
          </span>
          {visibility.reasonBadges.map(([reason, total]) => (
            <span
              key={reason}
              className="px-2 py-0.5 rounded-full bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]"
            >
              {reason}: {total}
            </span>
          ))}
        </div>
      </header>

      <div className="px-4 pt-3 space-y-4">
        {currentTarget ? (
          <>
            {/* ─── HERO SECTION: Item + Qty ─── */}
            <div className="ds-card p-4">
              {/* Item header with SKU */}
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-[var(--border-faint)]">
                <div className="min-w-0 flex-1">
                  <p className="font-mono font-bold text-sm text-[var(--content-primary)]">
                    {currentTarget.orderItem.item_alias ?? currentTarget.orderItem.item_id}
                  </p>
                  <p className="text-[var(--content-secondary)] text-sm mt-0.5 line-clamp-2">
                    {currentTarget.orderItem.item_name}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-[var(--bg-tertiary)] text-[var(--content-tertiary)] shrink-0">
                  {counts.picked + counts.flagged + 1} of {counts.total}
                </span>
              </div>

              {/* Hero quantity: always show remaining to pick */}
              <div className="pt-4 pb-3">
                <div className="mb-2 rounded-lg border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-accent)]">
                    Label Verify (Alias 1)
                  </p>
                  <p className="font-mono text-base font-bold text-[var(--content-primary)] leading-tight break-all whitespace-normal">
                    {currentAliasForVerification ?? 'No alias available'}
                  </p>
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] mb-1">
                  Remaining qty
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="font-mono font-bold text-[52px] leading-none text-[var(--content-primary)]">
                    {currentTargetProgress?.remainingQty ?? 0}
                  </span>
                  <span className="text-sm font-medium text-[var(--content-tertiary)]">pcs</span>
                </div>
                {currentTargetProgress && (
                  <p className="text-xs text-[var(--content-secondary)] mt-1">
                    Picked {currentTargetProgress.pickedQty} of {currentTargetProgress.targetQty}
                  </p>
                )}

                {/* Pack breakdown cards */}
                {currentBreakdown && (currentBreakdown.hasOuter || currentBreakdown.hasInner) && (
                  <div className="flex gap-2 mt-3">
                    {/* Outer/Master card */}
                    {currentBreakdown.hasOuter && (
                      <div
                        className={`flex-1 rounded-xl p-2.5 border-[1.5px] ${
                          currentBreakdown.outerQty === 0
                            ? 'opacity-35 bg-[var(--bg-accent-subtle)] border-[var(--border-accent)]'
                            : 'bg-[var(--bg-accent-subtle)] border-[var(--border-accent)]'
                        }`}
                      >
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--content-accent)]">
                          Master
                        </p>
                        <p className="font-mono font-bold text-[26px] leading-none text-[var(--content-accent)]">
                          {currentBreakdown.outerQty}
                        </p>
                        <p className="text-[9px] font-medium text-[var(--content-accent)]">
                          ×{currentPackDef?.outer_pack_qty ?? 0} ea
                        </p>
                      </div>
                    )}

                    {/* Inner card */}
                    {currentBreakdown.hasInner && (
                      <div
                        className={`flex-1 rounded-xl p-2.5 border-[1.5px] ${
                          currentBreakdown.innerQty === 0
                            ? 'opacity-35 bg-[var(--bg-positive-subtle)] border-[var(--border-positive)]'
                            : 'bg-[var(--bg-positive-subtle)] border-[var(--border-positive)]'
                        }`}
                      >
                        <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--content-positive)]">
                          Inner
                        </p>
                        <p className="font-mono font-bold text-[26px] leading-none text-[var(--content-positive)]">
                          {currentBreakdown.innerQty}
                        </p>
                        <p className="text-[9px] font-medium text-[var(--content-positive)]">
                          ×{currentPackDef?.inner_pack_qty ?? 0} = {currentBreakdown.innerPcs}
                        </p>
                      </div>
                    )}

                    {/* Loose card */}
                    <div
                      className={`flex-1 rounded-xl p-2.5 border-[1.5px] ${
                        currentBreakdown.looseQty === 0
                          ? 'opacity-35 bg-[var(--bg-tertiary)] border-[var(--border-subtle)]'
                          : 'bg-[var(--bg-tertiary)] border-[var(--border-subtle)]'
                      }`}
                    >
                      <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                        Loose
                      </p>
                      <p className="font-mono font-bold text-[26px] leading-none text-[var(--content-secondary)]">
                        {currentBreakdown.looseQty}
                      </p>
                      <p className="text-[9px] font-medium text-[var(--content-tertiary)]">
                        + {currentBreakdown.looseQty} pcs
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Location strip */}
              <div className="flex items-center gap-2 bg-[var(--bg-tertiary)] rounded-lg px-3 py-2">
                <MapPin size={16} weight="fill" className="text-[var(--content-tertiary)] shrink-0" />
                <span className="text-[11px] text-[var(--content-tertiary)]">Location</span>
                <span className="font-mono font-bold text-sm text-[var(--content-primary)] ml-auto">
                  {currentTarget.orderItem.rack_no ?? '—'}
                </span>
              </div>
            </div>

            {/* ─── SCANNING SECTION ─── */}
            {liveScanSession ? (
              /* Active scanning state - show tier progress */
              <div className="ds-card p-4 space-y-3">
                {/* Scan progress header */}
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono font-bold text-xs text-[var(--content-primary)]">
                      {currentTarget.orderItem.item_alias ?? currentTarget.orderItem.item_id}
                    </p>
                    <div className="mt-1 rounded-md border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] px-2 py-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-accent)]">
                        Alias 1
                      </p>
                      <p className="font-mono text-xs font-bold text-[var(--content-primary)] leading-tight break-all whitespace-normal">
                        {currentAliasForVerification ?? 'N/A'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={closeLiveScan}
                    className="text-xs text-[var(--content-tertiary)] ml-2 shrink-0"
                  >
                    Cancel
                  </button>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--bg-positive)] rounded-full transition-all duration-300"
                      style={{ width: `${totalScansTotal > 0 ? (totalScansDone / totalScansTotal) * 100 : 0}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-[var(--content-tertiary)]">
                    {totalScansDone} of {totalScansTotal} scans
                  </p>
                </div>

                {/* Tier rows */}
                <div className="space-y-2">
                  {currentTiers.map((tier) => {
                    const TierIcon = tier.icon;
                    const isActive = tier.state === 'active';
                    const isDone = tier.state === 'done';

                    return (
                      <div
                        key={tier.tier}
                        className={`flex items-center gap-3 rounded-xl border-[1.5px] p-3 transition-all ${
                          isDone
                            ? 'bg-[var(--bg-positive-subtle)] border-[var(--border-positive)]'
                            : isActive
                              ? 'bg-[var(--bg-secondary)] border-[var(--border-selected)]'
                              : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] opacity-40'
                        }`}
                      >
                        {/* Icon */}
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                            isDone
                              ? 'bg-[var(--bg-positive-subtle)]'
                              : tier.tier === 'outer'
                                ? 'bg-[var(--bg-accent-subtle)]'
                                : tier.tier === 'inner'
                                  ? 'bg-[var(--bg-positive-subtle)]'
                                  : 'bg-[var(--bg-tertiary)]'
                          }`}
                        >
                          {isDone ? (
                            <Check size={18} weight="bold" className="text-[var(--content-positive)]" />
                          ) : (
                            <TierIcon
                              size={18}
                              weight="fill"
                              className={
                                tier.tier === 'outer'
                                  ? 'text-[var(--content-accent)]'
                                  : tier.tier === 'inner'
                                    ? 'text-[var(--content-positive)]'
                                    : 'text-[var(--content-tertiary)]'
                              }
                            />
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                            {tier.label}
                          </p>
                          <p className={`font-mono font-bold text-xl leading-tight ${isDone ? 'text-[var(--content-positive)]' : 'text-[var(--content-primary)]'}`}>
                            {tier.scanned}
                            <span className="text-sm text-[var(--content-tertiary)]"> / {tier.target}</span>
                          </p>
                          {isActive && (
                            <p className="text-[10px] text-[var(--content-tertiary)]">
                              scan {tier.label.toLowerCase()} QR
                            </p>
                          )}
                          {isDone && (
                            <p className="text-[10px] text-[var(--content-positive)]">done</p>
                          )}
                        </div>

                        {/* Status dot */}
                        <div
                          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                            isDone
                              ? 'bg-[var(--bg-positive)]'
                              : isActive
                                ? 'bg-[var(--content-primary)]'
                                : 'bg-[var(--border-subtle)]'
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Scanner hint zone */}
                <div className="border-[1.5px] border-dashed border-[var(--border-selected)] rounded-2xl p-5 flex flex-col items-center gap-2">
                  <Camera size={32} weight="regular" className="text-[var(--content-primary)]" />
                  <p className="font-semibold text-sm text-[var(--content-primary)]">
                    {activeTier ? `Scan ${activeTier.label.toLowerCase()}` : 'All scans complete'}
                  </p>
                  <p className="text-[11px] text-[var(--content-tertiary)] text-center">
                    {activeTier
                      ? `Point camera at the QR on the ${activeTier.label.toLowerCase()} label`
                      : 'Ready to complete this line'}
                  </p>
                </div>

                {scannerHint && (
                  <p className="text-xs text-[var(--content-secondary)] bg-[var(--bg-tertiary)] rounded-lg px-3 py-2">
                    {scannerHint}
                  </p>
                )}
              </div>
            ) : (
              /* Not scanning - show CTA */
              <div className="space-y-3">
                <BigButton
                  variant="primary"
                  onClick={() => openLiveScan(currentTarget.orderItem)}
                  className="bg-[var(--bg-inverse-primary)] text-[var(--content-on-color)]"
                >
                  <Camera size={20} weight="bold" />
                  Start scanning
                </BigButton>

                {/* Secondary actions */}
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => handlePick(currentTarget.orderItem.id)}
                    className="h-11 rounded-xl bg-[var(--bg-tertiary)] text-sm font-medium text-[var(--content-secondary)]"
                  >
                    +1 manual
                  </button>
                  <button
                    onClick={() => {
                      setManualQtyTargetItemId(currentTarget.orderItem.id);
                      setManualQtyInput('1');
                    }}
                    className="h-11 rounded-xl bg-[var(--bg-accent-subtle)] text-sm font-medium text-[var(--content-accent)]"
                  >
                    Enter qty
                  </button>
                  <button
                    onClick={() => handleOverride(currentTarget.orderItem.id)}
                    className="h-11 rounded-xl bg-[var(--bg-warning-subtle)] text-sm font-medium text-[var(--content-warning)]"
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
                    className="h-11 rounded-xl bg-[var(--bg-negative-subtle)] text-sm font-medium text-[var(--content-negative)]"
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

        {upNext.length > 0 && (
          <div className="ds-card p-3">
            <p className="ds-label mb-2">Up Next</p>
            <div className="space-y-1.5">
              {upNext.map((pi, idx) => (
                <div
                  key={pi.orderItem.id}
                  className="flex items-center gap-3 py-1.5"
                >
                  <span className="w-5 h-5 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-[10px] font-semibold text-[var(--content-tertiary)] shrink-0">
                    {idx + 2}
                  </span>
                  <span className="font-mono text-xs text-[var(--content-warning)] min-w-14 shrink-0">
                    {pi.orderItem.rack_no ?? '—'}
                  </span>
                  <span className="flex-1 truncate text-sm text-[var(--content-secondary)]">
                    {pi.orderItem.item_name}
                  </span>
                  <span className="font-mono text-xs text-[var(--content-tertiary)] shrink-0">
                    ×{pickQuantityTarget(pi.orderItem)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {done.length > 0 && (
          <div className="ds-card p-3">
            <p className="ds-label mb-2">Completed ({done.length})</p>
            <div className="space-y-1">
              {done.slice(0, 8).map((pi) => (
                <div
                  key={pi.orderItem.id}
                  className="flex items-center gap-2 py-1 text-xs text-[var(--content-tertiary)]"
                >
                  {pi.uiState === 'flagged' ? (
                    <Flag size={14} weight="fill" className="text-[var(--content-negative)] shrink-0" />
                  ) : (
                    <CheckCircle size={14} weight="fill" className="text-[var(--content-positive)] shrink-0" />
                  )}
                  <span className="flex-1 truncate">{pi.orderItem.item_name}</span>
                  <span className="font-mono text-[var(--content-quaternary)]">
                    {pi.orderItem.rack_no ?? '—'}
                  </span>
                </div>
              ))}
              {done.length > 8 && (
                <p className="text-[10px] text-[var(--content-quaternary)] text-center pt-1">
                  +{done.length - 8} more
                </p>
              )}
            </div>
          </div>
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

      {liveScanSession && (
        <LiveQrScanner
          key={liveScanSession.orderItem.id}
          title={liveScanSession.orderItem.item_name}
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
