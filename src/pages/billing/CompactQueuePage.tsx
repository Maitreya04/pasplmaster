import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase/client';
import { useClaimableOrders, isSalesEditFreshLock } from '../../hooks/useClaimableOrders';
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
import { completeBillingWithClaim } from '../../lib/billing/completeBilling';
import {
  defaultFulfillmentPath,
  shouldNotifyPickers,
} from '../../lib/billing/fulfillmentPath';
import { FulfillmentPathSelector } from '../../components/billing/FulfillmentPathSelector';
import type { FulfillmentPath, StockLocationCode } from '../../types';
import { invalidateLocationwiseStockQueries } from '../../hooks/useLocationwiseStock';
import { buildSalesCommunicateDraft } from '../../lib/buildSalesCommunicateDraft';
import { NotificationBell } from '../../components/notifications/NotificationBell';
import { useRolePushNotifications } from '../../hooks/useRolePushNotifications';
import { PushAlertsCompact } from '../../components/notifications/PushAlertsCompact';
import { Check, Copy, Lightning, CheckCircle, Warning, Question, CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import type { OrderItem } from '../../types';
import { isFocOrderItem } from '../../lib/specialPricing';
import { applyWarehousePickSkipForPoOnlyLine } from '../../lib/cartSupply';
import { BILLING_OOS_FLAG_REASON, flagsFromCompactDecisions } from '../../lib/billing/applyBillingApprove';
import {
  countEffectivePickLinesAfterBilling,
  resolveFulfillmentPathAfterBilling,
} from '../../lib/billing/billLineOutcome';
import { persistAndNotifySalesOrderUpdate } from '../../lib/billing/notifySalesOrderUpdate';

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
  fulfillmentPath,
  onFulfillmentPathChange,
  stockLocationCode,
  pickLineCount,
  onAdvance,
  onJump,
  onFinish,
}: {
  orderName: string;
  items: OrderItem[];
  activeIndex: number;
  isSubmitting?: boolean;
  fulfillmentPath: FulfillmentPath;
  onFulfillmentPathChange: (path: FulfillmentPath) => void;
  stockLocationCode: StockLocationCode | null | undefined;
  pickLineCount: number;
  onAdvance: () => void;
  onJump: (i: number) => void;
  onFinish: () => void;
}) {
  const { copy, copiedId } = useCopyToClipboard();
  const isComplete = activeIndex >= items.length;
  const activeItem = isComplete ? null : items[activeIndex];
  const progress = items.length > 0 ? Math.min(activeIndex / items.length, 1) : 0;
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');

  // Flash state — we re-key the flash bar each time a copy happens
  const [flashKey, setFlashKey] = useState(0);
  const [showFlash, setShowFlash] = useState(false);
  const handleJump = useCallback(
    (index: number) => {
      setDirection(index < activeIndex ? 'backward' : 'forward');
      onJump(index);
    },
    [activeIndex, onJump],
  );
  const handleAdvance = useCallback(() => {
    setDirection('forward');
    onAdvance();
  }, [onAdvance]);
  const handleFinish = useCallback(() => {
    setDirection('forward');
    onFinish();
  }, [onFinish]);

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
          handleJump(activeIndex - 1);
          return;
        }

        if (isComplete) {
          handleFinish();
        } else if (activeItem) {
          const textToCopy = activeItem.item_alias || activeItem.item_name;
          copy(textToCopy, `compact-${activeItem.id}`);
          setFlashKey((k) => k + 1);
          setShowFlash(true);
          setTimeout(() => setShowFlash(false), 600);
          handleAdvance();
        }
      }

      if (e.key === 'Escape' && !isComplete) {
        e.preventDefault();
        handleAdvance(); // skip without copying
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isComplete, activeItem, copy, handleAdvance, handleJump, handleFinish, activeIndex]);

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
          <p className="text-xs text-[var(--content-secondary)] mb-4">Press Enter to finalize</p>
          <div className="w-full mb-4">
            <FulfillmentPathSelector
              value={fulfillmentPath}
              onChange={onFulfillmentPathChange}
              stockLocationCode={stockLocationCode}
              pickLineCount={pickLineCount}
              disabled={isSubmitting}
              compact
            />
          </div>
          <button
            onClick={handleFinish}
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

        {isFocOrderItem(activeItem!) && (
          <div className="flex justify-center mb-3">
            <span className="inline-flex items-center rounded-full border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--content-positive)]">
              FOC · ₹0
            </span>
          </div>
        )}

        {/* Qty + Rate row */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="font-ds-micro uppercase tracking-wider text-[var(--content-tertiary)] mb-0.5">Qty</p>
            <p className="text-2xl font-mono font-bold text-[var(--content-primary)]">{activeItem!.qty_requested}</p>
          </div>
          {activeItem!.price_quoted != null && (
            <div className="text-center">
              <p className="font-ds-micro uppercase tracking-wider text-[var(--content-tertiary)] mb-0.5">Rate</p>
              <p className="text-lg font-mono font-bold text-[var(--content-secondary)]">{formatCurrency(activeItem!.price_quoted)}</p>
            </div>
          )}
          {activeItem!.rack_no && (
            <div className="text-center">
              <p className="font-ds-micro uppercase tracking-wider text-[var(--content-tertiary)] mb-0.5">Rack</p>
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
                <kbd className="font-mono bg-[var(--bg-secondary)] border border-[var(--border-opaque)] rounded px-1 py-0.5 font-ds-micro shadow-sm">Enter</kbd>
                {' '}copy & next
              </span>
            )}
          </div>
        </div>

        {/* Mini nav */}
        <div className="px-4 pb-2.5 flex items-center justify-between">
          <button
            onClick={() => handleJump(activeIndex - 1)}
            disabled={activeIndex === 0}
            className="text-xs font-semibold text-[var(--content-tertiary)] hover:text-[var(--content-primary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-0.5"
          >
            <CaretLeft size={10} weight="bold" />
            Back
          </button>
          <button
            onClick={() => {
              handleAdvance(); // skip without copy
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
        <p className="font-ds-micro font-bold tracking-widest uppercase text-[var(--content-tertiary)]">
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
            {item.item_alias && <p className="font-mono font-ds-micro text-[var(--content-tertiary)]">{item.item_alias}</p>}
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
  fulfillmentPath,
  onFulfillmentPathChange,
  stockLocationCode,
  pickLineCount,
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
  fulfillmentPath: FulfillmentPath;
  onFulfillmentPathChange: (path: FulfillmentPath) => void;
  stockLocationCode: StockLocationCode | null | undefined;
  pickLineCount: number;
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
      <p className="font-ds-label-size text-[var(--content-secondary)] mb-4 line-clamp-4 whitespace-pre-wrap text-left w-full rounded-lg bg-[var(--bg-tertiary)] p-2 border border-[var(--border-subtle)]">
        {draftText}
      </p>

      <div className="w-full space-y-3">
        <FulfillmentPathSelector
          value={fulfillmentPath}
          onChange={onFulfillmentPathChange}
          stockLocationCode={stockLocationCode}
          pickLineCount={pickLineCount}
          disabled={isSubmitting}
          compact
        />
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
  const { available, myActive, stale, salesLocked, isLoading: queueLoading } = useClaimableOrders({
    stage: 'billing',
    workflowStatus: 'submitted',
  });

  const queue = useMemo(
    () => sortByUrgencyAndAge([...myActive, ...available, ...stale]),
    [myActive, available, stale],
  );

  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const currentOrderId = myActive[0]?.id ?? selectedOrderId;

  const activeInQueue = useMemo(() => {
    if (currentOrderId) {
      const found = queue.find((o) => o.id === currentOrderId);
      if (found) return found;
      const frozen = salesLocked.find((o) => o.id === currentOrderId);
      if (frozen) return frozen;
    }
    if (myActive.length > 0) return myActive[0];
    return queue[0] ?? null;
  }, [myActive, currentOrderId, queue, salesLocked]);

  const effectiveOrderId = activeInQueue?.id ?? null;

  // 2. Work Claim
  const { claimId, isClaimedByMe, claim, release } = useWorkClaim(effectiveOrderId, 'billing');

  // 3. Order Detail
  const { data: order, isLoading: orderLoading } = useOrderDetail(effectiveOrderId);
  const items = useMemo(() => order?.items ?? [], [order]);

  // 4. State Machine
  const machine = useBillingFlowMachine(items);

  const compactFlags = useMemo(
    () => flagsFromCompactDecisions(items, machine.decisions),
    [items, machine.decisions],
  );
  const pickLineCount = useMemo(
    () => countEffectivePickLinesAfterBilling(items, compactFlags),
    [items, compactFlags],
  );
  const autoFulfillmentPath = useMemo(
    () =>
      order
        ? defaultFulfillmentPath(order.stock_location_code, pickLineCount)
        : ('warehouse_pick' as FulfillmentPath),
    [order, pickLineCount],
  );
  const [manualFulfillmentPath, setManualFulfillmentPath] = useState<FulfillmentPath | null>(null);
  const fulfillmentScopeKey = `${order?.id ?? ''}:${pickLineCount}:${order?.stock_location_code ?? ''}`;
  const [boundFulfillmentScopeKey, setBoundFulfillmentScopeKey] = useState(fulfillmentScopeKey);
  if (fulfillmentScopeKey !== boundFulfillmentScopeKey) {
    setBoundFulfillmentScopeKey(fulfillmentScopeKey);
    setManualFulfillmentPath(null);
  }
  const fulfillmentPath = manualFulfillmentPath ?? autoFulfillmentPath;

  // Auto-claim on commit
  const claimAttempted = useRef<number | null>(null);
  const resetMachine = machine.reset;
  const salesFrozenBlocksCommit =
    activeInQueue != null &&
    machine.state === 'commit' &&
    isSalesEditFreshLock(activeInQueue);
  const frozenBlockKey = salesFrozenBlocksCommit ? String(activeInQueue.id) : null;
  const [handledFrozenBlockKey, setHandledFrozenBlockKey] = useState<string | null>(null);
  if (frozenBlockKey !== null && frozenBlockKey !== handledFrozenBlockKey) {
    setHandledFrozenBlockKey(frozenBlockKey);
    resetMachine();
    setSelectedOrderId(null);
  } else if (frozenBlockKey === null && handledFrozenBlockKey !== null) {
    setHandledFrozenBlockKey(null);
  }
  useEffect(() => {
    if (handledFrozenBlockKey === null || !activeInQueue) return;
    claimAttempted.current = null;
    const who = activeInQueue.sales_edit_claim_info?.claimed_by_name ?? 'Sales';
    toast.warning(`This order is frozen — ${who} is editing it from My Orders.`);
  }, [handledFrozenBlockKey, activeInQueue, toast]);

  useEffect(() => {
    if (machine.state !== 'commit' || !effectiveOrderId || isClaimedByMe) return;
    if (activeInQueue && isSalesEditFreshLock(activeInQueue)) return;
    if (claimAttempted.current === effectiveOrderId) return;
    claimAttempted.current = effectiveOrderId;
    void (async () => {
      const result = await claim();
      if (!result.success && result.reason === 'locked_by_sales_edit') {
        const who =
          typeof result.locked_by_name === 'string' && result.locked_by_name.trim()
            ? result.locked_by_name.trim()
            : 'Sales';
        toast.warning(`Locked — ${who} is editing this order from sales.`);
        claimAttempted.current = null;
        resetMachine();
        setSelectedOrderId(null);
      }
    })();
  }, [machine.state, effectiveOrderId, isClaimedByMe, claim, toast, resetMachine, activeInQueue]);

  // Skip / Release
  const handleSkip = useCallback(async () => {
    if (claimId && userId) {
      try {
        await release();
      } catch {
        console.warn('Failed to release claim gracefully');
      }
    }
    setSelectedOrderId(null);
    claimAttempted.current = null;
    machine.reset();
  }, [claimId, userId, release, machine]);

  // Park
  const parkMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error('No order');
      const { error } = await supabase
        .from('orders')
        .update({ workflow_status: 'flagged', notes: 'Parked by Billing operator for review' })
        .eq('id', order.id);
      if (error) throw error;
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
      if (!order || !userId) throw new Error('Cannot approve.');
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

      const flags = flagsFromCompactDecisions(items, machine.decisions);
      const resolvedFulfillmentPath = resolveFulfillmentPathAfterBilling(
        fulfillmentPath,
        order.stock_location_code,
        countEffectivePickLinesAfterBilling(items, flags),
      );

      const nowIso = new Date().toISOString();
      const { error: resolvePendingError } = await supabase
        .from('pending_items')
        .update({
          status: 'resolved',
          resolved_at: nowIso,
          resolved_by: reviewer,
        })
        .eq('order_id', order.id)
        .eq('status', 'pending');
      if (resolvePendingError) throw resolvePendingError;

      for (const item of finalItems) {
        const approvedQty = item.approvedQty;
        const qtyPo = Math.max(0, item.qty_requested - approvedQty);
        const update: Record<string, unknown> = {
          qty_approved: approvedQty,
          qty_shippable: approvedQty,
          qty_po: qtyPo,
        };
        if (item.decision === 'drop_entirely') {
          update.qty_approved = 0;
          update.qty_shippable = 0;
          update.qty_po = item.qty_requested;
          update.flag_reason = BILLING_OOS_FLAG_REASON;
        }
        applyWarehousePickSkipForPoOnlyLine(update, item, {
          fulfillmentPath: resolvedFulfillmentPath,
          currentState: item.state,
        });
        const { error: updateError } = await supabase.from('order_items').update(update).eq('id', item.id);
        if (updateError) throw updateError;

        if (item.decision === 'bill_available_po_rest') {
          const pendingVal = item.qty_requested - item.approvedQty;
          if (pendingVal > 0) {
            const { error: pendingError } = await supabase.from('pending_items').insert({
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
            if (pendingError) throw pendingError;
          }
        }
      }

      const customerLines = finalItems.map((item) => {
        const approvedQty = item.approvedQty;
        const qtyPending =
          item.decision === 'drop_entirely'
            ? item.qty_requested
            : Math.max(0, item.qty_requested - approvedQty);
        const qtyBilled = item.decision === 'drop_entirely' ? 0 : approvedQty;
        return {
          itemId: item.item_id,
          name: item.item_name,
          qtyRequested: item.qty_requested,
          qtyBilled,
          qtyPending,
        };
      });

      try {
        const { messageText } = await persistAndNotifySalesOrderUpdate({
          orderId: order.id,
          orderNumber: order.order_number,
          customerName: order.customer_name,
          salespersonName: order.salesperson_name,
          createdBy: reviewer,
          lines: customerLines,
          notifySales: true,
        });
        if (vars?.salesDraftText?.trim() && vars.salesDraftText.trim() !== messageText) {
          await sendInternalNotification({
            eventType: 'order_update_for_sales',
            orderId: order.id,
            orderNumber: order.order_number,
            customerName: order.customer_name,
            salespersonName: order.salesperson_name,
            messageBody: vars.salesDraftText.trim(),
          });
        }
      } catch (e) {
        console.error('order_update_for_sales', e);
        toast.error(
          `Sales notification failed: ${formatInternalNotificationError(e)}. Deploy send-internal-notification and run migration 014.`,
        );
      }

      const billingComplete = await completeBillingWithClaim({
        orderId: order.id,
        claimId,
        userId,
        claim,
        isResolvingFlags: false,
        fulfillmentPath: resolvedFulfillmentPath,
      });

      if (
        (fulfillmentPath === 'warehouse_pick' && resolvedFulfillmentPath === 'direct_bill') ||
        billingComplete.pick_path_downgraded
      ) {
        toast.info('No pickable lines — order direct-billed (skipped warehouse pick).');
      }

      if (shouldNotifyPickers(resolvedFulfillmentPath)) {
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
      }

      return order.order_number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', effectiveOrderId] });
      void invalidateLocationwiseStockQueries(queryClient);
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
        <p className="font-ds-micro font-semibold text-[var(--content-quaternary)] tracking-widest uppercase">
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
                setSelectedOrderId(activeInQueue.id);
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
            fulfillmentPath={fulfillmentPath}
            onFulfillmentPathChange={setManualFulfillmentPath}
            stockLocationCode={order.stock_location_code}
            pickLineCount={pickLineCount}
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
            fulfillmentPath={fulfillmentPath}
            onFulfillmentPathChange={setManualFulfillmentPath}
            stockLocationCode={order.stock_location_code}
            pickLineCount={pickLineCount}
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
