import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { useClaimableOrders } from '../../hooks/useClaimableOrders';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { useWorkClaim } from '../../hooks/useWorkClaim';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useBillingFlowMachine } from '../../hooks/useBillingFlowMachine';
import type { FlagIssue, ResolveDecision, ManualFlag } from '../../hooks/useBillingFlowMachine';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { formatCurrency } from '../../utils/formatters';
import {
  formatInternalNotificationError,
  sendInternalNotification,
  sendPickerReadyNotification,
} from '../../lib/pickerPush';
import { buildSalesCommunicateDraft } from '../../lib/buildSalesCommunicateDraft';
import { NotificationBell } from '../../components/notifications/NotificationBell';
import { useRolePushNotifications } from '../../hooks/useRolePushNotifications';
import { PushAlertsCompact } from '../../components/notifications/PushAlertsCompact';
import { Check, Copy, Lightning, CheckCircle, Warning, Question, CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import type { OrderItem } from '../../types';

function sortByUrgencyAndAge(orders: OrderWithClaimInfo[]): OrderWithClaimInfo[] {
  return [...orders].sort((a, b) => {
    if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
    if (a.priority !== 'urgent' && b.priority === 'urgent') return 1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

// ═══════════════════════════════════════════════════════════════
// Compact sub-views — each fits in ~300×400px
// ═══════════════════════════════════════════════════════════════

function CompactOrient({
  total,
  isLoading,
  nextName,
  nextCount,
  isUrgent,
  onStart,
}: {
  total: number;
  isLoading: boolean;
  nextName?: string;
  nextCount?: number;
  isUrgent?: boolean;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-5 text-center">
      <div className="w-10 h-10 rounded-xl bg-[var(--bg-accent)] flex items-center justify-center mb-4 shadow">
        <Lightning size={20} weight="fill" className="text-white" />
      </div>
      <h1 className="text-4xl font-bold text-[var(--content-primary)] tracking-tight mb-1">
        {isLoading ? '…' : total}
      </h1>
      <p className="text-sm font-medium text-[var(--content-secondary)] mb-6">orders waiting</p>

      {isUrgent && (
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] rounded-full text-xs font-bold tracking-widest uppercase mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--bg-negative)] animate-pulse" />
          URGENT
        </div>
      )}

      <button
        type="button"
        onClick={onStart}
        disabled={isLoading || total === 0}
        className="w-full h-12 rounded-xl bg-[var(--role-primary)] text-white text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
      >
        ▶ Start Next
      </button>

      {nextName && (
        <p className="mt-4 text-xs text-[var(--content-tertiary)] truncate w-full">
          Next: {nextName} · {nextCount} items
        </p>
      )}
    </div>
  );
}

function CompactCommit({
  orderName,
  itemCount,
  isUrgent,
  isClaiming,
  onCommit,
  onSkip,
}: {
  orderName: string;
  itemCount: number;
  isUrgent: boolean;
  isClaiming: boolean;
  onCommit: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col h-full p-5">
      <button
        onClick={onSkip}
        className="self-start text-xs font-semibold text-[var(--content-tertiary)] hover:text-[var(--content-primary)] mb-4 transition-colors flex items-center gap-1"
      >
        <CaretLeft size={12} weight="bold" />
        Skip
      </button>

      <div className="flex-1 flex flex-col justify-center text-center">
        {isUrgent && (
          <span className="inline-block self-center px-2.5 py-0.5 rounded-md bg-[var(--bg-negative)] text-white text-xs font-bold tracking-widest uppercase mb-3">
            Urgent
          </span>
        )}
        <h2 className="text-2xl font-bold text-[var(--content-primary)] leading-tight mb-2 truncate">
          {orderName}
        </h2>
        <p className="text-sm text-[var(--content-secondary)]">
          {itemCount} items to enter
        </p>
      </div>

      <button
        onClick={onCommit}
        disabled={isClaiming}
        className="w-full h-12 rounded-xl bg-[var(--role-primary)] text-white text-sm font-bold hover:opacity-90 active:scale-[0.97] transition-all disabled:opacity-50 shadow-md"
      >
        {isClaiming ? 'Claiming…' : 'Open in Busy → Start'}
      </button>
    </div>
  );
}

function CompactProcess({
  orderName,
  items,
  activeIndex,
  isSubmitting,
  onAdvance,
  onJump,
  onFinish,
}: {
  orderName: string;
  items: OrderItem[];
  activeIndex: number;
  isSubmitting?: boolean;
  onAdvance: () => void;
  onJump: (i: number) => void;
  onFinish: () => void;
}) {
  const { copy, copiedId } = useCopyToClipboard();
  const isComplete = activeIndex >= items.length;
  const activeItem = isComplete ? null : items[activeIndex];
  const progress = items.length > 0 ? Math.min(activeIndex / items.length, 1) : 0;

  // Track direction for animations
  const prevIndexRef = useRef(activeIndex);
  const direction = activeIndex >= prevIndexRef.current ? 'forward' : 'backward';
  useEffect(() => {
    prevIndexRef.current = activeIndex;
  }, [activeIndex]);

  // Flash state — we re-key the flash bar each time a copy happens
  const [flashKey, setFlashKey] = useState(0);
  const [showFlash, setShowFlash] = useState(false);

  // Keyboard bindings
  const lastEnter = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      if (e.key === 'Enter') {
        const now = Date.now();
        if (now - lastEnter.current < 400) return;
        lastEnter.current = now;
        e.preventDefault();

        if (e.shiftKey) {
          onJump(activeIndex - 1);
          return;
        }

        if (isComplete) {
          onFinish();
        } else if (activeItem) {
          const textToCopy = activeItem.item_alias || activeItem.item_name;
          copy(textToCopy, `compact-${activeItem.id}`);
          setFlashKey((k) => k + 1);
          setShowFlash(true);
          setTimeout(() => setShowFlash(false), 600);
          onAdvance();
        }
      }

      if (e.key === 'Escape' && !isComplete) {
        e.preventDefault();
        onAdvance(); // skip without copying
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isComplete, activeItem, copy, onAdvance, onJump, onFinish, activeIndex]);

  if (isComplete) {
    return (
      <div className="flex flex-col h-full p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold text-[var(--content-secondary)] truncate flex-1">{orderName}</p>
          <span className="text-xs font-mono text-[var(--content-tertiary)] ml-2">{items.length}/{items.length}</span>
        </div>
        <div className="h-1 rounded-full bg-[var(--border-subtle)] mb-5 overflow-hidden">
          <div className="h-full rounded-full bg-[var(--bg-positive)] transition-all duration-300" style={{ width: '100%' }} />
        </div>

        {/* Done state */}
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 bg-[var(--bg-positive-subtle)] rounded-full flex items-center justify-center mb-4">
            <CheckCircle size={28} weight="fill" className="text-[var(--content-positive)]" />
          </div>
          <h2 className="text-xl font-bold text-[var(--content-primary)] mb-1">All Items Done</h2>
          <p className="text-xs text-[var(--content-secondary)] mb-6">Press Enter to finalize</p>
          <button
            onClick={onFinish}
            disabled={isSubmitting}
            className="w-full h-11 rounded-xl bg-[var(--bg-positive)] text-white text-sm font-bold hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 shadow-md flex items-center justify-center gap-2"
          >
            {isSubmitting ? 'Approving…' : 'Finish in PASPL'}
          </button>
        </div>
      </div>
    );
  }

  const isCopied = activeItem && (
    copiedId === `compact-${activeItem.id}` ||
    copiedId === `click-compact-${activeItem.id}` ||
    copiedId === `click-name-compact-${activeItem.id}`
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header bar: name + progress */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-semibold text-[var(--content-secondary)] truncate flex-1">{orderName}</p>
          <span className="text-xs font-mono text-[var(--content-tertiary)] ml-2">{activeIndex + 1}/{items.length}</span>
        </div>
        <div className="h-1 rounded-full bg-[var(--border-subtle)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--role-primary)] transition-all duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      {/* Main content — the item */}
      <div
        key={activeItem!.id}
        className={`flex-1 flex flex-col items-center justify-center px-4 py-3 ${direction === 'forward' ? 'animate-slide-in-right' : 'animate-slide-out-left'} opacity-0 [animation-fill-mode:forwards]`}
      >
        {/* Code — hero element */}
        {activeItem!.item_alias ? (
          <button
            onClick={() => {
              copy(activeItem!.item_alias!, `click-compact-${activeItem!.id}`);
              setFlashKey((k) => k + 1);
              setShowFlash(true);
              setTimeout(() => setShowFlash(false), 600);
            }}
            className="group cursor-pointer bg-transparent border-0 p-0 mb-2 relative"
          >
            <h1 className="text-4xl font-mono font-bold text-[var(--content-primary)] tracking-tight transition-transform active:scale-95 select-all">
              {activeItem!.item_alias}
            </h1>
            <span className="absolute -right-5 -top-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {isCopied ? (
                <Check size={14} className="text-[var(--content-positive)]" weight="bold" />
              ) : (
                <Copy size={14} className="text-[var(--content-tertiary)]" />
              )}
            </span>
          </button>
        ) : (
          <p className="text-base font-mono text-[var(--content-quaternary)] mb-2">No Code</p>
        )}

        {/* Item name */}
        <button
          onClick={() => {
            if (!activeItem!.item_alias) {
              copy(activeItem!.item_name, `click-name-compact-${activeItem!.id}`);
              setFlashKey((k) => k + 1);
              setShowFlash(true);
              setTimeout(() => setShowFlash(false), 600);
            }
          }}
          className={`text-sm text-[var(--content-secondary)] text-center leading-snug mb-4 px-2 max-w-full bg-transparent border-0 p-0 ${!activeItem!.item_alias ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-default'}`}
        >
          {activeItem!.item_name}
        </button>

        {/* Qty + Rate row */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-[var(--content-tertiary)] mb-0.5">Qty</p>
            <p className="text-2xl font-mono font-bold text-[var(--content-primary)]">{activeItem!.qty_requested}</p>
          </div>
          {activeItem!.price_quoted != null && (
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-[var(--content-tertiary)] mb-0.5">Rate</p>
              <p className="text-lg font-mono font-bold text-[var(--content-secondary)]">{formatCurrency(activeItem!.price_quoted)}</p>
            </div>
          )}
          {activeItem!.rack_no && (
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-[var(--content-tertiary)] mb-0.5">Rack</p>
              <p className="text-lg font-mono font-bold text-[var(--content-secondary)]">{activeItem!.rack_no}</p>
            </div>
          )}
        </div>
      </div>

      {/* Bottom strip: flash + hint + nav */}
      <div className="shrink-0 border-t border-[var(--border-faint)] relative">
        {/* Green flash overlay */}
        {showFlash && (
          <div
            key={flashKey}
            className="absolute inset-0 bg-[var(--bg-positive)] animate-copied-flash pointer-events-none z-10"
          />
        )}

        <div className="px-4 py-2.5 flex items-center justify-between relative z-20">
          {/* Feedback text */}
          <div className="flex-1 text-center">
            {isCopied ? (
              <span className="text-xs font-bold text-[var(--content-positive)] flex items-center justify-center gap-1">
                <Check size={12} weight="bold" />
                Copied!
              </span>
            ) : (
              <span className="text-xs text-[var(--content-quaternary)]">
                <kbd className="font-mono bg-[var(--bg-secondary)] border border-[var(--border-opaque)] rounded px-1 py-0.5 text-[10px] shadow-sm">Enter</kbd>
                {' '}copy & next
              </span>
            )}
          </div>
        </div>

        {/* Mini nav */}
        <div className="px-4 pb-2.5 flex items-center justify-between">
          <button
            onClick={() => onJump(activeIndex - 1)}
            disabled={activeIndex === 0}
            className="text-xs font-semibold text-[var(--content-tertiary)] hover:text-[var(--content-primary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-0.5"
          >
            <CaretLeft size={10} weight="bold" />
            Back
          </button>
          <button
            onClick={() => {
              onAdvance(); // skip without copy
            }}
            className="text-xs font-semibold text-[var(--content-tertiary)] hover:text-[var(--content-primary)] transition-colors flex items-center gap-0.5"
          >
            Skip
            <CaretRight size={10} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
}

function CompactResolve({
  orderName,
  item,
  issue,
  issueIndex,
  totalIssues,
  onDecide,
  onPark,
}: {
  orderName: string;
  item: OrderItem;
  issue: { type: string; description: string };
  issueIndex: number;
  totalIssues: number;
  onDecide: (d: 'bill_available' | 'bill_available_po_rest' | 'drop_entirely') => void;
  onPark: () => void;
}) {
  const requested = item.qty_requested;
  const available = item.qty_shippable || 0;

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto">
      <div className="text-center mb-3">
        <p className="text-[10px] font-bold tracking-widest uppercase text-[var(--content-tertiary)]">
          Issue {issueIndex + 1}/{totalIssues}
        </p>
        <p className="text-xs text-[var(--content-secondary)] truncate">{orderName}</p>
      </div>

      <div className="bg-[var(--bg-secondary)] rounded-xl p-4 border border-[var(--border-warning)] mb-3">
        <div className="flex items-start gap-2 mb-3">
          <Warning size={18} weight="fill" className="text-[var(--content-warning)] shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-[var(--content-primary)] leading-tight">
              {issue.type === 'no_stock' ? 'No stock'
                : issue.type === 'partial_stock' ? 'Partial stock'
                : 'Needs attention'}
            </p>
            <p className="text-xs text-[var(--content-secondary)] mt-0.5 truncate">{item.item_name}</p>
            {item.item_alias && <p className="font-mono text-[10px] text-[var(--content-tertiary)]">{item.item_alias}</p>}
          </div>
        </div>
        <div className="p-2 bg-[var(--bg-warning-subtle)] rounded-lg border border-[var(--border-warning)]">
          <p className="text-xs font-semibold text-[var(--content-warning)]">{issue.description}</p>
        </div>
      </div>

      <div className="space-y-2 flex-1">
        {(issue.type === 'no_stock' || issue.type === 'partial_stock') && (
          <>
            <button
              className="w-full text-left p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:border-[var(--role-primary)] hover:bg-[var(--role-primary-subtle)] transition-all text-xs"
              onClick={() => onDecide('bill_available_po_rest')}
            >
              <p className="font-bold text-[var(--content-primary)]">Bill {available}, PO rest ({requested - available})</p>
            </button>
            <button
              className="w-full text-left p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:border-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-all text-xs"
              onClick={() => onDecide('bill_available')}
            >
              <p className="font-bold text-[var(--content-primary)]">Bill {available} only, drop rest</p>
            </button>
          </>
        )}
        <button
          className="w-full text-left p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:border-[var(--border-negative)] hover:bg-[var(--bg-negative-subtle)] transition-all text-xs"
          onClick={() => onDecide('drop_entirely')}
        >
          <p className="font-bold text-[var(--content-negative)]">Remove entirely</p>
        </button>
      </div>

      <button
        onClick={onPark}
        className="mt-3 w-full p-2.5 rounded-lg border border-[var(--border-opaque)] bg-transparent text-xs font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-center gap-1.5"
      >
        <Question size={14} />
        Park Order
      </button>
    </div>
  );
}

function CompactCommunicate({
  orderNumber,
  orderName,
  salesperson,
  items,
  issues,
  decisions,
  manualFlags,
  isSubmitting,
  onSkip,
  onSend,
}: {
  orderNumber: string;
  orderName: string;
  salesperson: string | null;
  items: OrderItem[];
  issues: FlagIssue[];
  decisions: Record<number, ResolveDecision>;
  manualFlags: Record<number, ManualFlag>;
  isSubmitting: boolean;
  onSkip: () => void;
  onSend: (draftText: string) => void;
}) {
  const draftText = buildSalesCommunicateDraft({
    orderNumber,
    orderName,
    salesperson,
    items,
    issues,
    decisions,
    manualFlags,
  });

  return (
    <div className="flex flex-col items-center justify-center h-full p-5 text-center">
      <Warning size={24} weight="fill" className="text-[var(--content-warning)] mb-3" />
      <h2 className="text-base font-bold text-[var(--content-primary)] mb-1">Notify sales</h2>
      <p className="text-[11px] text-[var(--content-secondary)] mb-4 line-clamp-4 whitespace-pre-wrap text-left w-full rounded-lg bg-[var(--bg-tertiary)] p-2 border border-[var(--border-subtle)]">
        {draftText}
      </p>

      <div className="w-full space-y-2">
        <button
          onClick={() => onSend(draftText)}
          disabled={isSubmitting}
          className="w-full h-11 rounded-xl bg-[var(--bg-accent)] text-white text-sm font-bold hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 shadow-md"
        >
          {isSubmitting ? 'Approving…' : 'Notify & approve'}
        </button>
        <button
          onClick={onSkip}
          disabled={isSubmitting}
          className="w-full h-9 rounded-lg border border-[var(--border-opaque)] text-xs font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
        >
          Skip notification
        </button>
      </div>
    </div>
  );
}

function CompactComplete({
  orderName,
  totalWaiting,
  onAutoAdvance,
}: {
  orderName: string;
  totalWaiting: number;
  onAutoAdvance: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onAutoAdvance, 1500);
    return () => clearTimeout(t);
  }, [onAutoAdvance]);

  return (
    <div className="flex flex-col items-center justify-center h-full p-5 text-center bg-[var(--bg-positive)]">
      <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center mb-4 shadow-inner">
        <CheckCircle size={28} weight="bold" className="text-white" />
      </div>
      <h2 className="text-xl font-bold text-white mb-2">{orderName} done</h2>
      <p className="text-sm text-white/80">{totalWaiting} remaining</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Main Compact Queue Page
// ═══════════════════════════════════════════════════════════════

export default function CompactQueuePage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userName, userId, role } = useAuth();
  const push = useRolePushNotifications({ role, userId, userName });

  // 1. Queue Data
  const { available, myActive, stale, isLoading: queueLoading } = useClaimableOrders({
    stage: 'billing',
    workflowStatus: 'submitted',
  });

  const queue = useMemo(
    () => sortByUrgencyAndAge([...myActive, ...available, ...stale]),
    [myActive, available, stale],
  );

  const [currentOrderId, setCurrentOrderId] = useState<number | null>(null);

  // Sync active order
  useEffect(() => {
    if (myActive.length > 0 && currentOrderId !== myActive[0].id) {
      setCurrentOrderId(myActive[0].id);
    }
  }, [myActive, currentOrderId]);

  const activeInQueue = useMemo(() => {
    if (currentOrderId) {
      const found = queue.find((o) => o.id === currentOrderId);
      if (found) return found;
    }
    if (myActive.length > 0) return myActive[0];
    return queue[0] ?? null;
  }, [myActive, currentOrderId, queue]);

  const effectiveOrderId = activeInQueue?.id ?? null;

  // 2. Work Claim
  const { claimId, isClaimedByMe, claim, release } = useWorkClaim(effectiveOrderId, 'billing');

  // 3. Order Detail
  const { data: order, isLoading: orderLoading } = useOrderDetail(effectiveOrderId);
  const items = useMemo(() => order?.items ?? [], [order]);

  // 4. State Machine
  const machine = useBillingFlowMachine(items);

  // Auto-claim on commit
  const claimAttempted = useRef<number | null>(null);
  useEffect(() => {
    if (
      machine.state === 'commit' &&
      effectiveOrderId &&
      !isClaimedByMe &&
      claimAttempted.current !== effectiveOrderId
    ) {
      claimAttempted.current = effectiveOrderId;
      claim();
    }
  }, [machine.state, effectiveOrderId, isClaimedByMe, claim]);

  // Skip / Release
  const handleSkip = useCallback(async () => {
    if (claimId && userId) {
      try {
        await release();
      } catch {
        console.warn('Failed to release claim gracefully');
      }
    }
    setCurrentOrderId(null);
    claimAttempted.current = null;
    machine.reset();
  }, [claimId, userId, release, machine]);

  // Park
  const parkMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
      await supabase
        .from('orders')
        .update({ workflow_status: 'flagged', notes: 'Parked by Billing operator for review' })
        .eq('id', order.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      toast.info(`Order ${order?.order_number} parked.`);
      handleSkip();
    },
    onError: () => toast.error('Failed to park order'),
  });

  // Approve
  const approveMutation = useMutation({
    mutationFn: async (vars?: { salesDraftText?: string }) => {
      if (!order || !claimId || !userId) throw new Error('Cannot approve.');
      const reviewer = userName || 'Billing';

      const finalItems = items.map((item) => {
        const decision = machine.decisions[item.id];
        let approvedQty = item.qty_shippable ?? item.qty_requested;

        if (decision === 'bill_available' || decision === 'bill_available_po_rest') {
          approvedQty = item.qty_shippable || 0;
        } else if (decision === 'drop_entirely') {
          approvedQty = 0;
        }

        return { ...item, approvedQty, decision };
      });

      for (const item of finalItems) {
        const update: Record<string, unknown> = { qty_approved: item.approvedQty };
        if (item.decision === 'drop_entirely') update.qty_approved = 0;
        await supabase.from('order_items').update(update).eq('id', item.id);

        if (item.decision === 'bill_available_po_rest') {
          const pendingVal = item.qty_requested - item.approvedQty;
          if (pendingVal > 0) {
            await supabase.from('pending_items').insert({
              order_id: order.id,
              order_number: order.order_number,
              customer_id: order.customer_id,
              customer_name: order.customer_name,
              item_id: item.item_id,
              item_name: item.item_name,
              qty_pending: pendingVal,
              source: 'billing',
              created_by: reviewer,
              note: 'Marked pending by billing (no stock in Busy)',
            });
          }
        }
      }

      const { error: rpcError } = await supabase.rpc('complete_billing', {
        p_order_id: order.id,
        p_claim_id: claimId,
        p_user_id: userId,
        p_is_resolving_flags: false,
      });
      if (rpcError) throw rpcError;

      if (vars?.salesDraftText) {
        try {
          const notifyResult = await sendInternalNotification({
            eventType: 'order_update_for_sales',
            orderId: order.id,
            orderNumber: order.order_number,
            customerName: order.customer_name,
            salespersonName: order.salesperson_name,
            messageBody: vars.salesDraftText,
          });
          if (notifyResult?.inboxCount === 0) {
            toast.info(
              'No sales users in the database received this update. Check users.role = sales and is_active.',
            );
          }
        } catch (e) {
          console.error('order_update_for_sales', e);
          toast.error(
            `Sales notification failed: ${formatInternalNotificationError(e)}. Deploy send-internal-notification and run migration 014.`,
          );
        }
      }

      try {
        await sendPickerReadyNotification({
          eventType: 'order_ready_to_pick',
          orderId: order.id,
          orderNumber: order.order_number,
          customerName: order.customer_name,
          priority: order.priority,
          approvedAt: new Date().toISOString(),
        });
      } catch {
        /* silent */
      }

      return order.order_number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', effectiveOrderId] });
      machine.confirmCommunication();
    },
    onError: () => toast.error('Failed to approve order'),
  });

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="role-billing density-compact h-screen w-screen bg-[var(--bg-primary)] overflow-hidden flex flex-col">
      {/* Tiny top bar — window drag area + context */}
      <div className="h-9 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] flex items-center justify-between px-2 shrink-0 select-none [-webkit-app-region:drag]">
        <span className="w-16" aria-hidden />
        <p className="text-[10px] font-semibold text-[var(--content-quaternary)] tracking-widest uppercase">
          PASPL Companion
        </p>
        <div className="w-16 flex items-center justify-end gap-0.5 [-webkit-app-region:no-drag]">
          <NotificationBell userId={userId} role={role} />
          <PushAlertsCompact label="Alerts" push={push} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {machine.state === 'orient' && (
          <CompactOrient
            total={queue.length}
            isLoading={queueLoading}
            nextName={queue[0]?.customer_name}
            nextCount={queue[0]?.item_count}
            isUrgent={queue.some((o) => o.priority === 'urgent')}
            onStart={() => {
              if (activeInQueue) {
                setCurrentOrderId(activeInQueue.id);
                machine.startCommit();
              }
            }}
          />
        )}

        {machine.state === 'commit' && (
          <>
            {(!order || orderLoading) ? (
              <div className="h-full bg-[var(--bg-primary)] animate-pulse" />
            ) : (
              <CompactCommit
                orderName={order.customer_name}
                itemCount={order.item_count}
                isUrgent={order.priority === 'urgent'}
                isClaiming={!isClaimedByMe}
                onCommit={machine.confirmCommit}
                onSkip={handleSkip}
              />
            )}
          </>
        )}

        {machine.state === 'process' && order && (
          <CompactProcess
            orderName={order.customer_name}
            items={items}
            activeIndex={machine.activeItemIndex}
            isSubmitting={approveMutation.isPending}
            onAdvance={machine.advanceProcessCursor}
            onJump={machine.jumpToItem}
            onFinish={() => {
              const hasIssues = machine.finishProcessPhase();
              if (!hasIssues) {
                approveMutation.mutate(undefined);
              }
            }}
          />
        )}

        {machine.state === 'resolve' && order && machine.currentIssue && (
          <CompactResolve
            orderName={order.customer_name}
            item={items[machine.currentIssue.itemIndex]}
            issue={machine.currentIssue}
            issueIndex={machine.activeIssueIndex}
            totalIssues={machine.issues.length}
            onDecide={(decision) =>
              machine.recordDecisionAndNext(items[machine.currentIssue!.itemIndex].id, decision)
            }
            onPark={() => parkMutation.mutate()}
          />
        )}

        {machine.state === 'communicate' && order && (
          <CompactCommunicate
            orderNumber={order.order_number}
            orderName={order.customer_name}
            salesperson={order.salesperson_name}
            items={items}
            issues={machine.issues}
            decisions={machine.decisions}
            manualFlags={machine.manualFlags}
            isSubmitting={approveMutation.isPending}
            onSkip={() => approveMutation.mutate(undefined)}
            onSend={(draftText) => approveMutation.mutate({ salesDraftText: draftText })}
          />
        )}

        {machine.state === 'complete' && (
          <CompactComplete
            orderName={order?.customer_name || 'Order'}
            totalWaiting={Math.max(0, queue.length - 1)}
            onAutoAdvance={handleSkip}
          />
        )}
      </div>
    </div>
  );
}
