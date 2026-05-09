import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  Flag,
  CaretLeft,
  Warning,
  Camera,
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
      const matchedBusyCode =
        packPayload && busyCodeCandidates.includes(packPayload.busyCode)
          ? packPayload.busyCode
          : null;
      const packDefinition = matchedBusyCode
        ? packDefinitionByBusyCode.get(matchedBusyCode)
        : null;
      const packQty =
        packPayload?.packType === 'inner'
          ? packDefinition?.inner_pack_qty ?? null
          : packPayload?.packType === 'outer'
            ? packDefinition?.outer_pack_qty ?? null
            : null;
      const lpnSuggested = lpnPayload?.remainingQty ?? null;
      const suggestedQty =
        classified.kind === 'lpn' && Number.isFinite(lpnSuggested)
          ? Math.max(1, Number(lpnSuggested))
          : Number.isFinite(packQty) && (packQty ?? 0) > 0
            ? Number(packQty)
            : 1;
      const requiresBreakConfirmation = suggestedQty > targetQty;
      const isPackMatch = Boolean(packPayload && matchedBusyCode && packDefinition);
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
        requiresBreakConfirmation,
        lpnCode: lpnPayload?.lpnCode ?? null,
        packAssist: isPackMatch
          ? {
              packType: packPayload!.packType,
              packQty: suggestedQty,
              suggestedQty,
              requiresBreakConfirmation,
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

      itemTransitionMutation.mutate({
        transition: {
          kind: 'scan_saved',
          itemId: current.orderItem.id,
          scanResult: result,
        },
      });

      if (requiresBreakConfirmation) {
        setPendingPackConfirmation({
          orderItemId: current.orderItem.id,
          scanResult: result,
          suggestedQty,
          targetQty,
        });
      }

      if (result.isMatch && !requiresBreakConfirmation) {
        appHaptics.success();
        setScannerHint(`Matched ${classified.kind.toUpperCase()} scan. Suggested qty ${suggestedQty}.`);
      } else {
        appHaptics.warning();
      }

      return result.isMatch ? null : current;
    });
  }, [
    lastScanMeta,
    itemTransitionMutation,
    packDefinitionByBusyCode,
    updateLocalItem,
    userId,
    userName,
  ]);

  const handlePick = useCallback(
    (itemId: number) => {
      appHaptics.impactMedium();
      const local = localItems.get(itemId);
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
      itemTransitionMutation.mutate({
        transition: {
          kind: 'picked',
          itemId,
          scanResult: manualScanResult,
        },
        optimisticState: 'picked',
      });
    },
    [itemTransitionMutation, localItems, userId, userName],
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
          <div className="rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-accent)] p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-[var(--content-tertiary)] font-semibold">
                  Current Target
                </p>
                <p className="font-semibold text-[var(--content-primary)] leading-snug">
                  {currentTarget.orderItem.item_name}
                </p>
                <p className="text-xs text-[var(--content-secondary)] mt-1">
                  Rack: {currentTarget.orderItem.rack_no ?? 'No rack'} · Qty target {pickQuantityTarget(currentTarget.orderItem)}
                </p>
                {currentTarget.scanResult?.packAssist && (
                  <p className="text-xs text-[var(--content-warning)] mt-1">
                    Pack assist: {currentTarget.scanResult.packAssist.packType} ({currentTarget.scanResult.packAssist.suggestedQty})
                  </p>
                )}
              </div>
              <span className="text-xs px-2 py-1 rounded-full bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]">
                {active.length} remaining
              </span>
            </div>
            {scannerHint && (
              <p className="text-xs text-[var(--content-secondary)] bg-[var(--bg-tertiary)] rounded-lg px-2 py-1">
                {scannerHint}
              </p>
            )}
            <BigButton
              variant="primary"
              onClick={() => openLiveScan(currentTarget.orderItem)}
              className="bg-[var(--bg-positive)] text-[var(--content-on-color)]"
            >
              <Camera size={20} weight="bold" />
              Scan Current Item
            </BigButton>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handlePick(currentTarget.orderItem.id)}
                className="h-11 rounded-xl bg-[var(--bg-tertiary)] text-sm font-medium text-[var(--content-secondary)]"
              >
                Confirm
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
          </div>
        ) : (
          <div className="rounded-2xl bg-[var(--bg-secondary)] p-4 text-sm text-[var(--content-secondary)]">
            No pending pick lines.
          </div>
        )}

        {upNext.length > 0 && (
          <div className="rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] p-3">
            <p className="text-xs uppercase tracking-wider text-[var(--content-tertiary)] font-semibold mb-2">
              Up Next
            </p>
            <div className="space-y-1.5">
              {upNext.map((pi) => (
                <div key={pi.orderItem.id} className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-[var(--content-warning)] min-w-12">
                    {pi.orderItem.rack_no ?? '--'}
                  </span>
                  <span className="flex-1 truncate text-[var(--content-secondary)]">
                    {pi.orderItem.item_name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {done.length > 0 && (
          <div className="rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-faint)] p-3">
            <p className="text-xs uppercase tracking-wider text-[var(--content-tertiary)] font-semibold mb-2">
              Done ({done.length})
            </p>
            <div className="space-y-1">
              {done.map((pi) => (
                <div key={pi.orderItem.id} className="flex items-center gap-2 text-xs text-[var(--content-secondary)]">
                  {pi.uiState === 'flagged' ? (
                    <Flag size={14} weight="fill" className="text-[var(--content-negative)]" />
                  ) : (
                    <CheckCircle size={14} weight="fill" className="text-[var(--content-positive)]" />
                  )}
                  <span className="flex-1 truncate">{pi.orderItem.item_name}</span>
                  <span className="font-mono">{pi.orderItem.rack_no ?? '--'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Complete button */}
      {allDone && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-[var(--bg-primary)] border-t border-[var(--border-subtle)]">
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
                <CheckCircle size={20} weight="bold" />
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
        title="Break Pack Confirmation"
      >
        {pendingPackConfirmation && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--content-secondary)]">
              This scan suggests picking {pendingPackConfirmation.suggestedQty} units while
              this line target is {pendingPackConfirmation.targetQty}. Confirm if you are
              breaking a pack and proceeding manually.
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
                  handlePick(pending.orderItemId);
                }}
                className="flex-1 bg-[var(--bg-warning)] text-[var(--content-primary)]"
              >
                Confirm Break Pack
              </BigButton>
            </div>
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
