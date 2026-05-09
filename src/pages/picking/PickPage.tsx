import { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  Flag,
  CaretLeft,
  MapPin,
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
  collectQrLookupCandidates,
  parsePackPickPayload,
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
  alias1: string | null;
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
          alias1: oi.catalog_alias1 ?? null,
        };
      }
      return {
        orderItem: oi,
        uiState: uiStateFromDb(oi),
        scanResult: oi.scan_result,
        alias1: oi.catalog_alias1 ?? null,
      };
    });
  }, [localItems, orderItems]);

  const { active, done } = useMemo(() => partitionItems(pickItems), [pickItems]);

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
      const targetQty = pickQuantityTarget(current.orderItem);
      const lookupCandidates = collectQrLookupCandidates(scan.rawValue);
      const packPayload = parsePackPickPayload(scan.rawValue);
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
      const suggestedQty = Number.isFinite(packQty) && (packQty ?? 0) > 0 ? Number(packQty) : 1;
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
      } else {
        appHaptics.warning();
      }

      return result.isMatch ? null : current;
    });
  }, [
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

      {/* Active items */}
      <div className="px-4 pt-3 space-y-2">
        {active.map((pi, idx) => (
          <PickItemCard
            key={pi.orderItem.id}
            item={pi}
            isNext={idx === 0}
            onPick={() => handlePick(pi.orderItem.id)}
            onFlag={() => {
              setFlagTarget(pi.orderItem.id);
              setFlagReason('');
              setFlagNotes('');
              setFlagBoxPrice('');
            }}
            onScan={() => openLiveScan(pi.orderItem)}
            onOverride={() => handleOverride(pi.orderItem.id)}
          />
        ))}
      </div>

      {/* Done items — compact */}
      {done.length > 0 && (
        <div className="px-4 pt-6">
          <p className="text-xs font-semibold text-[var(--content-tertiary)] uppercase tracking-wider mb-2">
            Done ({done.length})
          </p>
          <div className="space-y-1">
            {done.map((pi) => {
              const oi = pi.orderItem;
              const isFlagged = pi.uiState === 'flagged';
              return (
                <div
                  key={oi.id}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-faint)]"
                >
                  {isFlagged ? (
                    <Flag size={16} weight="fill" className="shrink-0 text-[var(--content-negative)]" />
                  ) : (
                    <CheckCircle size={16} weight="fill" className={`shrink-0 ${
                      pi.uiState === 'overridden' ? 'text-[var(--content-warning)]' : 'text-[var(--content-positive)]'
                    }`} />
                  )}
                  <span className="flex-1 text-sm text-[var(--content-secondary)] truncate">
                    {oi.item_name}
                  </span>
                  <span className="text-xs text-[var(--content-tertiary)] tabular-nums shrink-0">
                    Qty {pickQuantityTarget(oi)}
                  </span>
                  {oi.rack_no && (
                    <span className="text-xs text-[var(--content-quaternary)] font-mono shrink-0">
                      {oi.rack_no}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
          }}
          onClose={closeLiveScan}
          onResolved={handleScanResolved}
          onError={(message) => {
            toast.error(message);
            closeLiveScan();
          }}
        />
      )}
    </div>
  );
}

/* ─── PickItemCard ──────────────────────────────────────────── */

function PickItemCard({
  item,
  isNext = false,
  onPick,
  onFlag,
  onScan,
  onOverride,
}: {
  item: PickItemLocal;
  isNext?: boolean;
  onPick: () => void;
  onFlag: () => void;
  onScan: () => void;
  onOverride: () => void;
}) {
  const oi = item.orderItem;
  const isDone =
    item.uiState === 'picked' ||
    item.uiState === 'flagged' ||
    item.uiState === 'overridden';

  const borderColor: Record<PickItemUiState, string> = {
    pending: 'border-transparent',
    scanning: 'border-[var(--border-warning)] animate-pulse',
    matched: 'border-[var(--bg-positive)]',
    warning: 'border-[var(--border-warning)]',
    error: 'border-[var(--bg-negative)]',
    picked: 'border-[var(--bg-positive)]',
    flagged: 'border-[var(--bg-negative)]',
    overridden: 'border-[var(--border-warning)]',
  };

  return (
    <div
      className={`
        rounded-2xl p-4 border-l-4 ${borderColor[item.uiState]}
        ${isNext ? 'bg-[var(--bg-accent-subtle)] ring-1 ring-[var(--border-accent)]' : 'bg-[var(--bg-secondary)]'}
        transition-all duration-200
      `}
    >
      {/* NEXT badge */}
      {isNext && !isDone && (
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--bg-accent)] text-[var(--content-on-color)]">
            Next
          </span>
        </div>
      )}

      <div className="flex items-start gap-3">
        {/* Rack location — bigger for current (isNext) item */}
        <div className={`shrink-0 text-center ${isNext ? 'w-20' : 'w-16'}`}>
          {oi.rack_no ? (
            <div className={`flex flex-col items-center ${isNext ? 'bg-[var(--bg-warning-subtle)] rounded-xl py-2 px-1' : ''}`}>
              <MapPin
                size={isNext ? 20 : 16}
                weight="fill"
                className="text-[var(--content-warning)] mb-0.5"
              />
              <span className={`text-[var(--content-warning)] font-mono font-bold leading-tight ${isNext ? 'text-xl' : 'text-base'}`}>
                {oi.rack_no}
              </span>
            </div>
          ) : (
            <span className="text-xs text-[var(--content-disabled)]">
              No rack
            </span>
          )}
        </div>

        {/* Item info */}
        <div className="flex-1 min-w-0">
          <p className={`font-medium text-[var(--content-primary)] leading-snug ${isNext ? 'text-base' : 'text-sm'}`}>
            {oi.item_name}
          </p>
          {(oi.item_alias || item.alias1) && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {oi.item_alias && (
                <span className="text-xs text-[var(--content-tertiary)] font-mono bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-md">
                  Code: {oi.item_alias}
                </span>
              )}
              {item.alias1 && (
                <span className="text-xs text-[var(--content-tertiary)] font-mono bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-md">
                  Alias 1: {item.alias1}
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-xs font-semibold text-[var(--content-secondary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-md">
              {isDone ? pickQuantityTarget(oi) : 0} / {pickQuantityTarget(oi)} Picked
            </span>
            {item.scanResult?.packAssist && (
              <span className="text-xs font-semibold text-[var(--content-warning)] bg-[var(--bg-warning-subtle)] px-2 py-0.5 rounded-md">
                {item.scanResult.packAssist.packType} pack ({item.scanResult.packAssist.suggestedQty})
              </span>
            )}
            {item.uiState === 'flagged' && (
              <div className="flex flex-wrap gap-1">
                {oi.flag_reason && (
                  <span className="text-xs text-[var(--content-negative)]">{oi.flag_reason}</span>
                )}
                {typeof oi.flag_box_price === 'number' &&
                  !Number.isNaN(oi.flag_box_price) && (
                    <span className="text-xs text-[var(--content-negative)]">
                      Box price:{' '}
                      ₹
                      {oi.flag_box_price.toLocaleString('en-IN', {
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  )}
              </div>
            )}
            {item.uiState === 'scanning' && (
              <span className="text-xs text-[var(--content-warning)] animate-pulse">
                Scanning QR...
              </span>
            )}
            {item.uiState === 'matched' && item.scanResult && (
              <span className="text-xs text-[var(--content-positive)] truncate max-w-[200px] flex items-center gap-1">
                ✓ Verified {item.scanResult.extractedCode && `- ${item.scanResult.extractedCode}`} {item.scanResult.reason && `- ${item.scanResult.reason}`}
              </span>
            )}
          </div>

          {/* Scan Warning/Error Banner */}
          {item.uiState === 'warning' && item.scanResult && (
            <div className="mt-2 text-xs text-[var(--content-warning)] bg-[var(--bg-warning-subtle)] px-3 py-2 rounded-xl flex items-start gap-1.5 border border-[var(--border-warning)]/20">
              <Warning size={16} weight="bold" className="shrink-0 mt-0.5" />
              <span className="leading-tight">
                <span className="font-semibold block mb-0.5 text-[var(--content-warning)]">Verification Warning</span>
                {item.scanResult.reason || 'Item mismatch'}
                {item.scanResult.extractedDescription && (
                  <span className="block mt-1 text-[var(--content-tertiary)]">
                    Read: {item.scanResult.extractedDescription}
                  </span>
                )}
              </span>
            </div>
          )}
          {item.uiState === 'error' && item.scanResult && (
            <div className="mt-2 text-xs text-[var(--content-negative)] bg-[var(--bg-negative-subtle)] px-3 py-2 rounded-xl flex items-start gap-1.5 border border-[var(--border-negative)]/20">
              <Warning size={16} weight="bold" className="shrink-0 mt-0.5" />
              <span className="leading-tight">
                <span className="font-semibold block mb-0.5 text-[var(--content-negative)]">Verification Failed</span>
                {item.scanResult.reason || 'Item mismatch or barcode not recognized'}
                {item.scanResult.extractedDescription && (
                  <span className="block mt-1 text-[var(--content-tertiary)]">
                    Read: {item.scanResult.extractedDescription}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Action buttons — dynamic flow emphasizing scanning */}
      {!isDone && (
        <div className="mt-3 space-y-2">
          {/* Primary Action Button */}
          <button
            onClick={() => {
              if (['matched', 'warning'].includes(item.uiState)) {
                onPick();
              } else if (item.uiState === 'error') {
                onOverride();
              } else {
                onScan();
              }
            }}
            disabled={item.uiState === 'scanning'}
            className={`
              w-full flex items-center justify-center gap-2
              rounded-xl font-bold
              active:scale-[0.98] transition-all duration-150
              ${isNext
                ? ['error', 'warning'].includes(item.uiState)
                  ? 'h-14 text-base bg-[var(--bg-warning)] text-[var(--content-primary)] shadow-sm shadow-[var(--bg-warning)]/20'
                  : 'h-14 text-base bg-[var(--bg-positive)] text-[var(--content-on-color)] shadow-sm shadow-[var(--bg-positive)]/20'
                : ['error', 'warning'].includes(item.uiState)
                  ? 'h-12 text-sm bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]'
                  : 'h-12 text-sm bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
              }
            `}
          >
            {item.uiState === 'matched' ? (
              <>
                <CheckCircle size={20} weight="bold" />
                Confirm Picked
              </>
            ) : item.uiState === 'warning' ? (
              <>
                <CheckCircle size={20} weight="bold" />
                Confirm
              </>
            ) : item.uiState === 'error' ? (
              <>
                <Warning size={20} weight="bold" />
                Confirm anyway
              </>
            ) : (
              <>
                <Camera size={20} weight="bold" />
                {item.uiState === 'scanning' ? 'Scanning QR...' : 'Scan Item'}
              </>
            )}
          </button>

          {/* Secondary Actions */}
          <div className="flex items-center gap-2">
            {['matched', 'warning', 'error'].includes(item.uiState) && (
              <button
                onClick={onScan}
                className="
                  flex-1 h-11 flex items-center justify-center gap-1.5
                  rounded-xl bg-[var(--bg-tertiary)]
                  text-[var(--content-secondary)] text-sm font-medium
                  active:scale-95 transition-transform duration-100
                "
              >
                <Camera size={18} weight="bold" />
                Rescan
              </button>
            )}

            <button
              onClick={onPick}
              disabled={item.uiState === 'scanning'}
              className="
                flex-1 h-11 flex items-center justify-center gap-1.5
                rounded-xl bg-[var(--bg-tertiary)]
                text-[var(--content-secondary)] text-sm font-medium
                active:scale-95 transition-transform duration-100
                disabled:opacity-50
              "
              aria-label="Manual Pick"
            >
              <CheckCircle size={18} weight="bold" />
              Manual Pick
            </button>

            <button
              onClick={() => {
                appHaptics.warning();
                onFlag();
              }}
              className="
                flex-1 h-11 flex items-center justify-center gap-1.5
                rounded-xl bg-[var(--bg-negative-subtle)]
                text-[var(--content-negative)] text-sm font-medium
                active:scale-95 transition-transform duration-100
              "
              aria-label="Flag item"
            >
              <Flag size={16} weight="bold" />
              Flag
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
