import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import {
  BigButton,
  BottomSheet,
  ProgressBar,
  Skeleton,
  StatusBadge,
} from '../../components/shared';
import type { OrderItem, ScanResult } from '../../types';
import { FLAG_REASONS, type FlagReason } from '../../utils/constants';
import { PickCompleteScreen } from './PickCompleteScreen';
import { verifyWithGemini, imageToBase64 } from '../../lib/ocr/geminiOCR';


interface ItemMeta {
  mrp: number | null;
  main_group: string | null;
  alias1: string | null;
}
type ItemMetaMap = Map<number, ItemMeta>;

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
  thumbnailUrl: string | null;
  alias1: string | null;
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
    const res = oi.scan_result as Record<string, any>;
    const conf = res?.confidence || 0;
    if (res?.isMatch || conf >= 70) return 'matched';
    if (conf >= 40) return 'warning';
    return 'error';
  }
  return 'pending';
}

export default function PickPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userName } = useAuth();

  const orderId = id ? parseInt(id, 10) : null;
  const { data: order, isLoading, error } = useOrderDetail(orderId);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [itemMeta, setItemMeta] = useState<ItemMetaMap>(new Map());

  useEffect(() => {
    if (!order?.items?.length) return;
    const ids = order.items.map((oi) => oi.item_id);
    supabase
      .from('items')
      .select('id,mrp,main_group,alias1')
      .in('id', ids)
      .then(({ data }) => {
        if (!data) return;
        const m: ItemMetaMap = new Map();
        for (const row of data) {
          m.set(row.id, {
            mrp: row.mrp ?? null,
            main_group: row.main_group ?? null,
            alias1: row.alias1 ?? null,
          });
        }
        setItemMeta(m);
      });
  }, [order?.items]);

  const [localItems, setLocalItems] = useState<Map<number, Partial<PickItemLocal>>>(
    new Map(),
  );
  const [flagTarget, setFlagTarget] = useState<number | null>(null);
  const [flagReason, setFlagReason] = useState<FlagReason | ''>('');
  const [flagNotes, setFlagNotes] = useState('');
  const [flagBoxPrice, setFlagBoxPrice] = useState('');
  const [liveScanTarget, setLiveScanTarget] = useState<OrderItem | null>(null);

  const pickItems = useMemo(() => {
    if (!order?.items) return [];
    const sorted = sortByRack(order.items);
    return sorted.map((oi): PickItemLocal => {
      const local = localItems.get(oi.id);
      const meta = itemMeta.get(oi.item_id);
      if (local) {
        return {
          orderItem: oi,
          uiState: local.uiState ?? uiStateFromDb(oi),
          scanResult: local.scanResult ?? oi.scan_result,
          thumbnailUrl: local.thumbnailUrl ?? null,
          alias1: meta?.alias1 ?? null,
        };
      }
      return {
        orderItem: oi,
        uiState: uiStateFromDb(oi),
        scanResult: oi.scan_result,
        thumbnailUrl: null,
        alias1: meta?.alias1 ?? null,
      };
    });
  }, [itemMeta, localItems, order?.items]);

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

  const pickItemMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const { error } = await supabase
        .from('order_items')
        .update({ state: 'picked' })
        .eq('id', itemId);
      if (error) throw error;
    },
    onMutate: (itemId) => {
      updateLocalItem(itemId, { uiState: 'picked' });
    },
    onError: (_err, itemId) => {
      updateLocalItem(itemId, { uiState: 'pending' });
      toast.error('Failed to mark item as picked');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });

  const flagItemMutation = useMutation({
    mutationFn: async ({
      itemId,
      reason,
      notes,
      boxPrice,
    }: {
      itemId: number;
      reason: FlagReason;
      notes: string;
      boxPrice: number | null;
    }) => {
      if (!order) throw new Error('No order');
      const { error } = await supabase
        .from('order_items')
        .update({
          state: 'flagged',
          flag_reason: reason,
          flag_notes: notes || null,
          flag_box_price: boxPrice,
        })
        .eq('id', itemId);
      if (error) throw error;

      // If picker flags "Out of Stock", also create a pending_items entry
      if (reason === 'Out of Stock') {
        const target = order.items.find((oi) => oi.id === itemId);
        if (target) {
          const qtyPending = target.qty_approved ?? target.qty_requested;
          if (qtyPending > 0) {
            // Avoid duplicate pending rows for same order+item while status is pending
            const { data: existing, error: existingError } = await supabase
              .from('pending_items')
              .select('id')
              .eq('order_id', order.id)
              .eq('item_id', target.item_id)
              .eq('status', 'pending')
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
    },
    onMutate: ({ itemId }) => {
      updateLocalItem(itemId, { uiState: 'flagged' });
    },
    onError: (_err, { itemId }) => {
      updateLocalItem(itemId, { uiState: 'pending' });
      toast.error('Failed to flag item');
    },
    onSuccess: () => {
      setFlagTarget(null);
      setFlagReason('');
      setFlagNotes('');
      setFlagBoxPrice('');
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
  });

  const saveScanResultMutation = useMutation({
    mutationFn: async ({
      itemId,
      scanResult,
    }: {
      itemId: number;
      scanResult: ScanResult;
    }) => {
      const { error } = await supabase
        .from('order_items')
        .update({ scan_result: scanResult as unknown as Record<string, unknown> })
        .eq('id', itemId);
      if (error) throw error;
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
      const isCompleted = !hasFlagged;
      const updates: {
        status: 'completed' | 'flagged';
        completed_at?: string;
        priority?: 'normal';
      } = {
        status: isCompleted ? 'completed' : 'flagged',
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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      navigator.vibrate?.([50, 30, 50, 30, 100]);
      setShowComplete(true);
    },
    onError: () => {
      toast.error('Failed to complete order');
    },
  });

  const openLiveScan = useCallback((orderItem: OrderItem) => {
    setLiveScanTarget(orderItem);
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  const closeLiveScan = useCallback(() => {
    setLiveScanTarget(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !liveScanTarget) return;

    const itemId = liveScanTarget.id;
    const thumbnailUrl = URL.createObjectURL(file);
    updateLocalItem(itemId, { uiState: 'scanning', thumbnailUrl });

    try {
      const base64 = await imageToBase64(file, 800);
      const meta = itemMeta.get(liveScanTarget.item_id);
      
      const expectedItem = {
        name: liveScanTarget.item_name || '',
        alias: liveScanTarget.item_alias || '',
        alias1: meta?.alias1 || '',
        mrp: meta?.mrp || 0
      };

      const result = await verifyWithGemini(base64, expectedItem);
      console.log('Gemini result:', result);

      const conf = result.confidence;
      let uiState: PickItemUiState = 'error';
      if (conf >= 70) uiState = 'matched';
      else if (conf >= 40) uiState = 'warning';

      updateLocalItem(itemId, {
        uiState,
        scanResult: result as any,
        thumbnailUrl
      });

      saveScanResultMutation.mutate({
        itemId,
        scanResult: result as any
      });
    } catch (err) {
      console.error(err);
      toast.error('Verification failed');
      updateLocalItem(itemId, { uiState: 'pending' });
    } finally {
      closeLiveScan();
    }
  };

  const handlePick = useCallback(
    (itemId: number) => {
      navigator.vibrate?.(50);
      pickItemMutation.mutate(itemId);
    },
    [pickItemMutation],
  );

  const handleOverride = useCallback(
    (itemId: number) => {
      updateLocalItem(itemId, { uiState: 'overridden' });
      pickItemMutation.mutate(itemId);
    },
    [updateLocalItem, pickItemMutation],
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
      flagItemMutation.mutate({
        itemId: flagTarget,
        reason: flagReason,
        notes: flagNotes,
        boxPrice: parsed,
      });
      return;
    }

    flagItemMutation.mutate({
      itemId: flagTarget,
      reason: flagReason,
      notes: flagNotes,
      boxPrice: null,
    });
  }, [flagTarget, flagReason, flagNotes, flagBoxPrice, flagItemMutation, toast]);

  if (!orderId) {
    navigate('/picking');
    return null;
  }

  const [showComplete, setShowComplete] = useState(false);

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
      <div className="p-4 space-y-4">
        <Skeleton variant="text" lines={2} />
        <Skeleton variant="card" count={5} />
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="p-4 text-center">
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

  return (
    <div className="min-h-screen pb-32">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[var(--bg-primary)]/90 backdrop-blur-md px-4 py-3 space-y-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/picking')}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-[var(--content-secondary)]"
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
                    Qty {oi.qty_approved ?? oi.qty_requested}
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
            onClick={() => completeMutation.mutate()}
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
                  transition-colors duration-150 min-h-[48px]
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
            loading={flagItemMutation.isPending}
            className="bg-[var(--bg-negative)] text-[var(--content-on-color)]"
          >
            <Flag size={18} weight="fill" />
            Flag Item
          </BigButton>
        </div>
      </BottomSheet>

      {/* Live scan file input */}
      <input 
        type="file" 
        accept="image/*" 
        capture="environment" 
        ref={fileInputRef} 
        className="hidden" 
        onChange={handleFileChange} 
      />
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
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--bg-accent)] text-[var(--content-on-color)]">
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
              0 / {oi.qty_approved ?? oi.qty_requested} Picked
            </span>
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
                Verifying with AI...
              </span>
            )}
            {item.uiState === 'matched' && item.scanResult && (
              <span className="text-xs text-[var(--content-positive)] truncate max-w-[200px] flex items-center gap-1">
                ✓ Verified {(item.scanResult as any).extractedCode && `- ${(item.scanResult as any).extractedCode}`} {(item.scanResult as any).reason && `- ${(item.scanResult as any).reason}`}
              </span>
            )}
          </div>

          {/* Thumbnail for scanned items */}
          {item.thumbnailUrl && ['scanning', 'matched', 'warning', 'error'].includes(item.uiState) && (
            <img
              src={item.thumbnailUrl}
              alt="Scan"
              className="mt-2 h-12 rounded-lg object-cover"
            />
          )}

          {/* Scan Warning/Error Banner */}
          {item.uiState === 'warning' && item.scanResult && (
            <div className="mt-2 text-xs text-[var(--content-warning)] bg-[var(--bg-warning-subtle)] px-3 py-2 rounded-xl flex items-start gap-1.5 border border-[var(--border-warning)]/20">
              <Warning size={16} weight="bold" className="shrink-0 mt-0.5" />
              <span className="leading-tight">
                <span className="font-semibold block mb-0.5 text-[var(--content-warning)]">Verification Warning</span>
                {(item.scanResult as any).reason || 'Item mismatch'}
              </span>
            </div>
          )}
          {item.uiState === 'error' && item.scanResult && (
            <div className="mt-2 text-xs text-[var(--content-negative)] bg-[var(--bg-negative-subtle)] px-3 py-2 rounded-xl flex items-start gap-1.5 border border-[var(--border-negative)]/20">
              <Warning size={16} weight="bold" className="shrink-0 mt-0.5" />
              <span className="leading-tight">
                <span className="font-semibold block mb-0.5 text-[var(--content-negative)]">Verification Failed</span>
                {(item.scanResult as any).reason || 'Item mismatch or barcode not recognized'}
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
                {item.uiState === 'scanning' ? 'Verifying with AI...' : 'Scan Item'}
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
                navigator.vibrate?.([30, 50, 30]);
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
