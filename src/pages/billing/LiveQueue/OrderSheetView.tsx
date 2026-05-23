import { useState, useEffect, useRef, useCallback, useMemo, type ReactElement } from 'react';
import {
  ArrowLeft,
  ArrowCounterClockwise,
  Copy,
  Check,
  Warning,
  XCircle,
  Trash,
  Plus,
} from '@phosphor-icons/react';
import type { FulfillmentPath, OrderItem, StockLocationCode } from '../../../types';
import { countPickableOrderLines } from '../../../lib/cartSupply';
import { defaultFulfillmentPath } from '../../../lib/billing/fulfillmentPath';
import { FulfillmentPathSelector } from '../../../components/billing/FulfillmentPathSelector';
import type { BillingLineEdit, ItemFlag } from '../../../hooks/useBillingFlow';
import {
  billingFreshnessChipLabel,
  billingFreshnessChipTitle,
  type BillingFreshnessRow,
} from '../../../hooks/useBillingStockFreshness';
import { StatusBadge } from '../../../components/shared';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { getBookPrice, getQuotedPrice, isSpecialRateItem, summarizeSpecialPricing } from '../../../lib/specialPricing';
import {
  formatCurrency,
  formatTimeAgo,
  orderItemDisplayName,
  orderItemProductCode,
} from '../../../utils/formatters';

/** UI labels for billing (Windows-first). Finish still works with Cmd+Enter on Mac. */
const SHORTCUT_COPY_ALL = 'Alt+C';
const SHORTCUT_FINISH = 'Ctrl+Enter';

interface OrderSheetViewProps {
  orderName: string;
  orderNumber: string;
  salesperson: string | null;
  customerAddress: string | null;
  notes: string | null;
  city: string | null;
  itemCount: number;
  totalValue: number;
  priority: string;
  createdAt: string;
  stockLocationCode?: StockLocationCode | null;
  /** Raw server rows for this order (includes lines marked removed locally). */
  items: OrderItem[];
  flags: Record<number, ItemFlag>;
  lineEdits: Record<number, BillingLineEdit>;
  freshnessMap?: Record<number, BillingFreshnessRow>;
  sessionNewOrderItemIds?: ReadonlySet<number>;
  isClaiming: boolean;
  isApproving: boolean;
  isRejecting: boolean;
  addedLinesSessionCount?: number;
  onFlagNoStock: (orderItemId: number) => void;
  onFlagPartial: (orderItemId: number, availableQty: number) => void;
  onClearFlag: (orderItemId: number) => void;
  onEditLineQty: (orderItemId: number, qty: number) => void;
  onEditLineRate: (orderItemId: number, rate: number) => void;
  onRemoveLine: (orderItemId: number) => void;
  onRestoreLine: (orderItemId: number) => void;
  onApplyLiveStock: (orderItemId: number, liveCapacity: number) => Promise<void>;
  onOpenAddLine: () => void;
  onFinish: (fulfillmentPath: FulfillmentPath) => void;
  onReject: (reason: string) => void;
  onSkip: () => void;
}

type CopyState = 'ready' | 'copied' | 'settled';

function mergeLine(item: OrderItem, edit?: BillingLineEdit): OrderItem {
  if (!edit || edit.removed) return item;
  return {
    ...item,
    qty_requested: edit.qtyRequested ?? item.qty_requested,
    price_quoted: edit.priceQuoted ?? item.price_quoted,
  };
}

export function OrderSheetView({
  orderName,
  orderNumber,
  salesperson,
  customerAddress,
  notes,
  city,
  itemCount,
  totalValue,
  priority,
  createdAt,
  stockLocationCode,
  items,
  flags,
  lineEdits,
  freshnessMap,
  sessionNewOrderItemIds,
  isClaiming,
  isApproving,
  isRejecting,
  addedLinesSessionCount = 0,
  onFlagNoStock,
  onFlagPartial,
  onClearFlag,
  onEditLineQty,
  onEditLineRate,
  onRemoveLine,
  onRestoreLine,
  onApplyLiveStock,
  onOpenAddLine,
  onFinish,
  onReject,
  onSkip,
}: OrderSheetViewProps): ReactElement {
  const { copy } = useCopyToClipboard();
  const headerMeta = [orderNumber, salesperson].filter(Boolean).join(' · ');
  const customerLocation = [city, customerAddress?.trim()].filter(Boolean).join(' · ');
  const trimmedNotes = notes?.trim() ?? '';

  const visibleRows = useMemo(
    () => items.filter((i) => !lineEdits[i.id]?.removed),
    [items, lineEdits],
  );

  const pickLineCount = useMemo(
    () => countPickableOrderLines(visibleRows),
    [visibleRows],
  );

  const [fulfillmentPath, setFulfillmentPath] = useState<FulfillmentPath>(() =>
    defaultFulfillmentPath(stockLocationCode, pickLineCount),
  );

  useEffect(() => {
    setFulfillmentPath(defaultFulfillmentPath(stockLocationCode, pickLineCount));
  }, [orderNumber, stockLocationCode, pickLineCount]);

  const mergedVisibleRows = useMemo(
    () => visibleRows.map((i) => mergeLine(i, lineEdits[i.id])),
    [visibleRows, lineEdits],
  );

  const [copyState, setCopyState] = useState<CopyState>('ready');

  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [showHints, setShowHints] = useState(false);
  const hintsTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [partialInputRow, setPartialInputRow] = useState<number | null>(null);
  const [partialQty, setPartialQty] = useState('');
  const partialInputRef = useRef<HTMLInputElement>(null);

  const [editingQtyRow, setEditingQtyRow] = useState<number | null>(null);
  const [qtyDraft, setQtyDraft] = useState('');
  const [editingRateRow, setEditingRateRow] = useState<number | null>(null);
  const [rateDraft, setRateDraft] = useState('');

  const [showConfirm, setShowConfirm] = useState(false);
  const confirmFinishRef = useRef<HTMLButtonElement>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const [jumpBuffer, setJumpBuffer] = useState('');
  const jumpTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  type LastRemovedSnapshot = {
    id: number;
    name: string;
    qty: number;
    price: number | null;
    code: string | null;
  };
  const [lastRemoved, setLastRemoved] = useState<LastRemovedSnapshot | null>(null);
  const lastRemovedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleRemoveLine = useCallback(
    (orderItemId: number) => {
      const row = items.find((i) => i.id === orderItemId);
      if (row) {
        const merged = mergeLine(row, lineEdits[row.id]);
        setLastRemoved({
          id: row.id,
          name: orderItemDisplayName(merged),
          qty: merged.qty_requested,
          price: getQuotedPrice(merged) ?? merged.price_system ?? null,
          code: orderItemProductCode(merged) || null,
        });
        if (lastRemovedTimerRef.current) clearTimeout(lastRemovedTimerRef.current);
        lastRemovedTimerRef.current = setTimeout(() => setLastRemoved(null), 8000);
      }
      onRemoveLine(orderItemId);
    },
    [items, lineEdits, onRemoveLine],
  );

  const handleRestoreLine = useCallback(
    (orderItemId: number) => {
      if (lastRemoved?.id === orderItemId) {
        if (lastRemovedTimerRef.current) clearTimeout(lastRemovedTimerRef.current);
        setLastRemoved(null);
      }
      onRestoreLine(orderItemId);
    },
    [lastRemoved, onRestoreLine],
  );

  useEffect(() => {
    return () => {
      if (lastRemovedTimerRef.current) clearTimeout(lastRemovedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!lastRemoved) return;
    const stillRemoved = !!lineEdits[lastRemoved.id]?.removed;
    const stillPresent = items.some((i) => i.id === lastRemoved.id);
    if (!stillRemoved || !stillPresent) {
      if (lastRemovedTimerRef.current) clearTimeout(lastRemovedTimerRef.current);
      setLastRemoved(null);
    }
  }, [items, lineEdits, lastRemoved]);

  const flagCount = Object.keys(flags).length;
  const { specialLineCount, specialQty } = summarizeSpecialPricing(mergedVisibleRows);

  const removedCount = items.filter((i) => lineEdits[i.id]?.removed).length;
  const editCount = Object.entries(lineEdits).filter(
    ([, e]) =>
      !e.removed &&
      (e.qtyRequested !== undefined || e.priceQuoted !== undefined),
  ).length;

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  useEffect(() => {
    if (activeRow !== null && rowRefs.current[activeRow]) {
      rowRefs.current[activeRow]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeRow]);

  useEffect(() => {
    if (partialInputRow !== null && partialInputRef.current) {
      setTimeout(() => partialInputRef.current?.focus(), 50);
    }
  }, [partialInputRow]);

  useEffect(() => {
    if (copyState === 'copied') {
      const t = setTimeout(() => setCopyState('settled'), 1500);
      return () => clearTimeout(t);
    }
  }, [copyState]);

  const copyAllItems = useCallback(() => {
    const text = mergedVisibleRows
      .map((i) => `${orderItemDisplayName(i)}\t${i.qty_requested}`)
      .join('\n');
    copy(text, 'all-items');
    setCopyState('copied');
  }, [mergedVisibleRows, copy]);

  const showHintsTemporarily = useCallback(() => {
    setShowHints(true);
    if (hintsTimeoutRef.current) clearTimeout(hintsTimeoutRef.current);
    hintsTimeoutRef.current = setTimeout(() => setShowHints(false), 10_000);
  }, []);

  const handleFinishAttempt = useCallback(() => {
    if (isClaiming) return;
    if (mergedVisibleRows.length === 0) return;
    if (flagCount > 0 || editCount > 0 || removedCount > 0 || addedLinesSessionCount > 0) {
      setShowConfirm(true);
    } else {
      onFinish(fulfillmentPath);
    }
  }, [
    flagCount,
    editCount,
    removedCount,
    addedLinesSessionCount,
    onFinish,
    fulfillmentPath,
    isClaiming,
    mergedVisibleRows.length,
  ]);

  const confirmFinish = useCallback(() => {
    if (isApproving || isClaiming) return;
    setShowConfirm(false);
    onFinish(fulfillmentPath);
  }, [isApproving, isClaiming, onFinish, fulfillmentPath]);

  useEffect(() => {
    if (!showConfirm) return;
    const id = window.setTimeout(() => confirmFinishRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [showConfirm]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.altKey && e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (!isClaiming && mergedVisibleRows.length > 0) {
          copyAllItems();
          showHintsTemporarily();
        }
        return;
      }

      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (isClaiming || mergedVisibleRows.length === 0) return;
        if (showConfirm) {
          confirmFinish();
        } else {
          handleFinishAttempt();
        }
        return;
      }

      if (e.code === 'KeyA' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (!isClaiming) {
          onOpenAddLine();
          showHintsTemporarily();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (showReject) {
          e.preventDefault();
          if (!isRejecting) {
            setShowReject(false);
            setRejectReason('');
          }
          return;
        }
        if (showConfirm) {
          e.preventDefault();
          setShowConfirm(false);
          return;
        }
        if (partialInputRow !== null) {
          e.preventDefault();
          setPartialInputRow(null);
          setPartialQty('');
          return;
        }
        if (editingQtyRow !== null) {
          e.preventDefault();
          setEditingQtyRow(null);
          setQtyDraft('');
          return;
        }
        if (editingRateRow !== null) {
          e.preventDefault();
          setEditingRateRow(null);
          setRateDraft('');
          return;
        }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        showHintsTemporarily();
        setActiveRow((prev) =>
          prev === null ? 0 : Math.min(prev + 1, mergedVisibleRows.length - 1),
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        showHintsTemporarily();
        setActiveRow((prev) =>
          prev === null ? mergedVisibleRows.length - 1 : Math.max(prev - 1, 0),
        );
        return;
      }

      if (e.key === 'Tab' && !e.shiftKey && activeRow !== null && mergedVisibleRows.length > 0) {
        e.preventDefault();
        for (let i = 1; i <= mergedVisibleRows.length; i++) {
          const idx = (activeRow + i) % mergedVisibleRows.length;
          const it = mergedVisibleRows[idx];
          if (!flags[it.id]) {
            setActiveRow(idx);
            break;
          }
        }
        return;
      }

      if ((e.key === 'f' || e.key === 'F') && activeRow !== null) {
        e.preventDefault();
        const rowItem = mergedVisibleRows[activeRow];
        if (rowItem) {
          onFlagNoStock(rowItem.id);
          showHintsTemporarily();
        }
        return;
      }
      if ((e.key === 'p' || e.key === 'P') && activeRow !== null) {
        e.preventDefault();
        setPartialInputRow(activeRow);
        setPartialQty('');
        showHintsTemporarily();
        return;
      }
      if ((e.key === 's' || e.key === 'S') && activeRow !== null) {
        e.preventDefault();
        const rowItem = mergedVisibleRows[activeRow];
        if (rowItem && flags[rowItem.id]) {
          onClearFlag(rowItem.id);
          showHintsTemporarily();
        }
        return;
      }

      if ((e.key === 'e' || e.key === 'E') && activeRow !== null) {
        e.preventDefault();
        const rowItem = mergedVisibleRows[activeRow];
        if (rowItem) {
          setEditingQtyRow(activeRow);
          setQtyDraft(String(rowItem.qty_requested));
          showHintsTemporarily();
        }
        return;
      }
      if ((e.key === 'r' || e.key === 'R') && activeRow !== null) {
        e.preventDefault();
        const rowItem = mergedVisibleRows[activeRow];
        if (rowItem) {
          setEditingRateRow(activeRow);
          setRateDraft(String(rowItem.price_quoted ?? rowItem.price_system ?? 0));
          showHintsTemporarily();
        }
        return;
      }
      if ((e.key === 'x' || e.key === 'X' || e.key === 'Delete' || e.key === 'Backspace') && activeRow !== null) {
        if (e.key === 'Backspace' && mergedVisibleRows.length === 0) return;
        e.preventDefault();
        const rowItem = mergedVisibleRows[activeRow];
        if (rowItem) {
          handleRemoveLine(rowItem.id);
          showHintsTemporarily();
        }
        return;
      }

      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        showHintsTemporarily();
        const newBuffer = jumpBuffer + e.key;
        setJumpBuffer(newBuffer);
        if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
        jumpTimeoutRef.current = setTimeout(() => {
          const rowNum = parseInt(newBuffer, 10);
          if (rowNum >= 1 && rowNum <= mergedVisibleRows.length) setActiveRow(rowNum - 1);
          setJumpBuffer('');
        }, 400);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    mergedVisibleRows,
    activeRow,
    flags,
    partialInputRow,
    editingQtyRow,
    editingRateRow,
    showConfirm,
    showReject,
    jumpBuffer,
    onFlagNoStock,
    onClearFlag,
    handleFinishAttempt,
    confirmFinish,
    showHintsTemporarily,
    copyAllItems,
    isClaiming,
    isRejecting,
    onOpenAddLine,
    handleRemoveLine,
  ]);

  useEffect(() => {
    return () => {
      if (hintsTimeoutRef.current) clearTimeout(hintsTimeoutRef.current);
      if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
    };
  }, []);

  const confirmPartial = useCallback(() => {
    if (partialInputRow === null) return;
    const rowItem = mergedVisibleRows[partialInputRow];
    if (!rowItem) return;
    const qty = parseInt(partialQty, 10);
    const maxQty = rowItem.qty_requested;
    if (qty <= 0 || isNaN(qty)) {
      onFlagNoStock(rowItem.id);
    } else if (qty >= maxQty) {
      onClearFlag(rowItem.id);
    } else {
      onFlagPartial(rowItem.id, qty);
    }
    setPartialInputRow(null);
    setPartialQty('');
  }, [partialInputRow, partialQty, mergedVisibleRows, onFlagNoStock, onFlagPartial, onClearFlag]);

  const commitQtyEdit = useCallback(() => {
    if (editingQtyRow === null) return;
    const rowItem = mergedVisibleRows[editingQtyRow];
    if (!rowItem) return;
    const q = parseInt(qtyDraft, 10);
    const serverOrig =
      items.find((i) => i.id === rowItem.id)?.qty_requested ?? rowItem.qty_requested;
    const maxQty = serverOrig;
    if (!Number.isFinite(q) || q < 1 || q > maxQty) {
      setEditingQtyRow(null);
      setQtyDraft('');
      return;
    }
    onEditLineQty(rowItem.id, q);
    setEditingQtyRow(null);
    setQtyDraft('');
  }, [editingQtyRow, qtyDraft, mergedVisibleRows, items, onEditLineQty]);

  const commitRateEdit = useCallback(() => {
    if (editingRateRow === null) return;
    const rowItem = mergedVisibleRows[editingRateRow];
    if (!rowItem) return;
    const r = parseFloat(rateDraft.replace(',', ''));
    if (!Number.isFinite(r) || r < 0) {
      setEditingRateRow(null);
      setRateDraft('');
      return;
    }
    onEditLineRate(rowItem.id, r);
    setEditingRateRow(null);
    setRateDraft('');
  }, [editingRateRow, rateDraft, mergedVisibleRows, onEditLineRate]);

  const handleRejectConfirm = useCallback(() => {
    const trimmedReason = rejectReason.trim();
    if (!trimmedReason || isRejecting) return;
    onReject(trimmedReason);
  }, [rejectReason, isRejecting, onReject]);

  const billedNormalCount = mergedVisibleRows.filter((it) => !flags[it.id]).length;

  return (
    <div className="density-compact min-h-screen bg-[var(--bg-primary)] flex flex-col animate-slide-up">

      <div className="px-4 lg:px-6 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] shrink-0">
        <button
          onClick={onSkip}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--content-secondary)] hover:text-[var(--content-primary)] transition-colors px-2 py-1 -ml-2 rounded-lg hover:bg-[var(--bg-tertiary)]"
        >
          <ArrowLeft size={16} weight="bold" />
          Queue
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 lg:px-6 py-6 space-y-4">

          <div className="ds-card p-4 lg:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {priority === 'urgent' && <StatusBadge status="urgent" />}
                  <h1 className="text-xl font-bold text-[var(--content-primary)] truncate">
                    {orderName}
                  </h1>
                </div>
                {headerMeta && (
                  <p className="text-xs text-[var(--content-tertiary)]">
                    {headerMeta}
                  </p>
                )}
                {customerLocation && (
                  <p className="mt-1 text-sm text-[var(--content-tertiary)] line-clamp-2">
                    <span className="font-medium text-[var(--content-secondary)]">
                      {city}
                    </span>
                    {city && customerAddress?.trim() && (
                      <span className="px-1 text-[var(--content-quaternary)]">·</span>
                    )}
                    {customerAddress?.trim() && (
                      <span>{customerAddress.trim()}</span>
                    )}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-base font-mono font-semibold text-[var(--content-primary)] tabular-nums">
                  {formatCurrency(totalValue)}
                </p>
                <p className="font-ds-label-size text-[var(--content-quaternary)] mt-0.5">
                  {itemCount} items · {formatTimeAgo(createdAt)}
                </p>
              </div>
            </div>
            {specialLineCount > 0 && (
              <div className="mt-4 rounded-2xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 py-3">
                <p className="text-sm font-semibold text-[var(--content-warning)]">
                  Special-rate order on {specialLineCount} line{specialLineCount === 1 ? '' : 's'}
                  {specialQty > 0 ? ` · ${specialQty} pcs` : ''}.
                </p>
                <p className="mt-1 text-xs text-[var(--content-warning)]">
                  Busy may default to book price after paste. Use the highlighted quoted rate shown on each line while billing.
                </p>
              </div>
            )}
            {trimmedNotes && (
              <div className="mt-4 rounded-2xl border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--content-accent)]">
                  Sales note for billing
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-[var(--content-primary)]">
                  {trimmedNotes}
                </p>
              </div>
            )}
          </div>

          <button
            onClick={copyAllItems}
            disabled={isClaiming || mergedVisibleRows.length === 0}
            className={`w-full h-11 transition-all active:scale-[0.98] rounded-xl font-semibold inline-flex items-center justify-center gap-2 ${
              copyState === 'ready'
                ? 'bg-[var(--role-primary)] text-white text-sm shadow-sm hover:opacity-90'
                : copyState === 'copied'
                  ? 'bg-[var(--bg-positive)] text-white text-sm'
                  : 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] text-xs border border-[var(--border-positive)]'
            } ${isClaiming ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {copyState === 'ready' && (
              <>
                <Copy size={16} weight="bold" />
                <span>Copy {mergedVisibleRows.length} items to clipboard</span>
                <kbd className="hidden sm:inline-flex font-mono bg-white/15 border border-white/25 rounded-md px-1.5 py-0.5 text-[10px] font-medium ml-1 tabular-nums">
                  {SHORTCUT_COPY_ALL}
                </kbd>
              </>
            )}
            {copyState === 'copied' && (
              <>
                <Check size={16} weight="bold" />
                <span>Copied {mergedVisibleRows.length} items!</span>
              </>
            )}
            {copyState === 'settled' && (
              <>
                <Check size={14} weight="bold" />
                <span>Copied · Tap to re-copy</span>
              </>
            )}
          </button>

          <div className="ds-card overflow-hidden">
            <table className="ds-table w-full table-fixed">
              <thead>
                <tr>
                  <th className="w-14 text-center border-l-[3px] border-l-transparent">#</th>
                  <th className="min-w-0">Item</th>
                  <th className="hidden sm:table-cell w-[10.5rem] max-w-[10.5rem] lg:w-[13rem] lg:max-w-[13rem] align-top">
                    Code
                  </th>
                  <th className="text-right w-28">Rate</th>
                  <th className="text-right w-16">Qty</th>
                  <th className="text-right w-[8.5rem]">Status</th>
                  <th className="w-10 text-center pr-2"> </th>
                </tr>
              </thead>
              <tbody>
                {items.map((serverItem) => {
                  const removed = !!lineEdits[serverItem.id]?.removed;
                  if (removed) {
                    const removedCode = orderItemProductCode(serverItem);
                    const removedQty = serverItem.qty_requested;
                    const removedPrice =
                      getQuotedPrice(serverItem) ?? serverItem.price_system ?? null;
                    return (
                      <tr
                        key={`removed-${serverItem.id}`}
                        className="bg-[var(--bg-tertiary)]"
                      >
                        <td colSpan={7} className="py-2.5 px-3">
                          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div className="min-w-0 flex items-start gap-2">
                              <span className="ds-chip ds-chip--sm shrink-0 mt-0.5 bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] border-[var(--border-negative)]">
                                Removed
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[var(--content-primary)] line-through decoration-[var(--content-quaternary)] line-clamp-2">
                                  {orderItemDisplayName(serverItem)}
                                </p>
                                <p className="font-ds-label-size text-[var(--content-tertiary)] mt-0.5 tabular-nums">
                                  {removedCode ? (
                                    <span className="font-mono">{removedCode}</span>
                                  ) : null}
                                  {removedCode ? <span className="px-1">·</span> : null}
                                  <span>
                                    {removedQty} ×{' '}
                                    {removedPrice != null ? formatCurrency(removedPrice) : '—'}
                                  </span>
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="shrink-0 inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-xl text-xs font-semibold border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] hover:opacity-90 w-full sm:w-auto"
                              onClick={() => handleRestoreLine(serverItem.id)}
                            >
                              <ArrowCounterClockwise size={14} weight="bold" />
                              Undo remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const idx = mergedVisibleRows.findIndex((r) => r.id === serverItem.id);
                  const item = mergedVisibleRows[idx];
                  if (!item) return null;

                  const flag = flags[item.id];
                  const isActive = activeRow === idx;
                  const isPartialInput = partialInputRow === idx;
                  const productCode = orderItemProductCode(item);
                  const hasSpecialRate = isSpecialRateItem(item);
                  const quotedPrice = getQuotedPrice(item);
                  const bookPrice = getBookPrice(item);
                  const sys = item.price_system ?? 0;
                  const rateLooksLow =
                    sys > 0 &&
                    quotedPrice != null &&
                    quotedPrice < sys * 0.5;

                  const fresh = freshnessMap?.[item.id];
                  const serverQty = serverItem.qty_requested;
                  const qtyEdited =
                    lineEdits[item.id]?.qtyRequested != null &&
                    lineEdits[item.id]!.qtyRequested !== serverQty;
                  const serverPrice = serverItem.price_quoted ?? serverItem.price_system ?? 0;
                  const rateEdited =
                    lineEdits[item.id]?.priceQuoted != null &&
                    lineEdits[item.id]!.priceQuoted !== serverPrice;

                  let rowBg = '';
                  if (flag?.type === 'no_stock') rowBg = 'bg-[var(--bg-negative-subtle)]';
                  else if (flag?.type === 'partial') rowBg = 'bg-[var(--bg-warning-subtle)]';
                  else if (hasSpecialRate) rowBg = 'bg-[var(--bg-warning-subtle)]';

                  const isNew = sessionNewOrderItemIds?.has(item.id);
                  const isEdited = (qtyEdited || rateEdited) && !isNew;

                  let stripeColor = 'transparent';
                  if (flag?.type === 'no_stock') stripeColor = 'var(--border-negative)';
                  else if (flag?.type === 'partial') stripeColor = 'var(--border-warning)';
                  else if (isNew) stripeColor = 'var(--border-positive)';
                  else if (isEdited) stripeColor = 'var(--border-accent)';
                  else if (hasSpecialRate) stripeColor = 'var(--border-warning)';

                  return (
                    <tr
                      key={item.id}
                      ref={(el) => {
                        rowRefs.current[idx] = el;
                      }}
                      onClick={() => {
                        setActiveRow(idx);
                        showHintsTemporarily();
                      }}
                      className={`cursor-pointer ${rowBg} ${isActive ? 'ds-row--selected' : ''}`}
                    >
                      <td
                        className="text-center tabular-nums align-top pt-2 border-l-[3px]"
                        style={{ borderLeftColor: stripeColor }}
                      >
                        {isActive ? (
                          <span className="text-[var(--role-primary)] font-bold text-xs">&#9654;</span>
                        ) : (
                          <span className="text-[var(--content-quaternary)] text-xs font-mono">
                            {idx + 1}
                          </span>
                        )}
                      </td>

                      <td className="min-w-0 align-top">
                        <div className="flex items-start gap-2">
                          <p
                            className={`text-sm font-medium leading-snug whitespace-normal break-words [overflow-wrap:anywhere] min-w-0 flex-1 ${
                              flag ? 'text-[var(--content-secondary)]' : 'text-[var(--content-primary)]'
                            }`}
                          >
                            {orderItemDisplayName(item)}
                          </p>
                          {isNew && (
                            <span className="ds-chip ds-chip--sm shrink-0 bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border-[var(--border-positive)]">
                              New
                            </span>
                          )}
                          {isEdited && (
                            <span className="ds-chip ds-chip--sm shrink-0 bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border-[var(--border-accent)]">
                              Edited
                            </span>
                          )}
                        </div>
                        {productCode && (
                          <div className="mt-1 sm:hidden max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
                            <span
                              className="inline-block font-ds-label-size font-mono text-[var(--content-quaternary)] whitespace-nowrap"
                              title={productCode}
                            >
                              {productCode}
                            </span>
                          </div>
                        )}
                      </td>

                      <td className="hidden sm:table-cell align-top min-w-0 w-[10.5rem] max-w-[10.5rem] lg:w-[13rem] lg:max-w-[13rem]">
                        <div
                          className="max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]"
                          title={productCode || undefined}
                        >
                          <span className="inline-block font-ds-label-size font-mono text-[var(--content-quaternary)] whitespace-nowrap pr-1">
                            {productCode || '—'}
                          </span>
                        </div>
                      </td>

                      <td className="text-right align-top pt-2">
                        {editingRateRow === idx ? (
                          <div className="flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="number"
                              step={0.01}
                              min={0}
                              value={rateDraft}
                              onChange={(e) => setRateDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitRateEdit();
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setEditingRateRow(null);
                                  setRateDraft('');
                                }
                              }}
                              className="ds-input w-24 text-right text-sm font-mono py-1 px-2"
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="flex flex-col items-end gap-1 text-right w-full min-h-[44px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingRateRow(idx);
                              setRateDraft(String(item.price_quoted ?? item.price_system ?? 0));
                            }}
                          >
                            <span
                              className={`text-sm font-mono font-semibold tabular-nums ${
                                hasSpecialRate ? 'text-[var(--content-warning)]' : 'text-[var(--content-primary)]'
                              }`}
                            >
                              {formatCurrency(quotedPrice)}
                            </span>
                            {rateLooksLow && (
                              <span className="ds-chip ds-chip--warning ds-chip--sm">Low rate?</span>
                            )}
                            {hasSpecialRate && bookPrice != null && (
                              <>
                                <span className="ds-chip ds-chip--warning ds-chip--sm">Special</span>
                                <span className="text-[11px] text-[var(--content-quaternary)]">
                                  Book {formatCurrency(bookPrice)}
                                </span>
                              </>
                            )}
                          </button>
                        )}
                      </td>

                      <td className="text-right align-top pt-2">
                        {editingQtyRow === idx ? (
                          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="number"
                              min={1}
                              max={serverQty}
                              value={qtyDraft}
                              onChange={(e) => setQtyDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitQtyEdit();
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setEditingQtyRow(null);
                                  setQtyDraft('');
                                }
                              }}
                              className="ds-input w-14 text-right text-sm font-mono py-1 px-2"
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="inline-flex flex-col items-end gap-0.5 min-h-[44px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingQtyRow(idx);
                              setQtyDraft(String(item.qty_requested));
                            }}
                          >
                            {qtyEdited && (
                              <span className="text-[11px] line-through text-[var(--content-quaternary)] tabular-nums">
                                {serverQty}
                              </span>
                            )}
                            <span className="text-sm font-mono font-semibold text-[var(--content-primary)] tabular-nums">
                              {item.qty_requested}
                            </span>
                          </button>
                        )}
                      </td>

                      <td className="text-right align-top pt-1">
                        <div className="flex flex-col items-end gap-1">
                          {fresh?.isStale && fresh.liveCapacity != null && (
                            fresh.canApplyLive ? (
                              <button
                                type="button"
                                className="ds-chip ds-chip--sm bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border-[var(--border-accent)] max-w-[11rem] text-left"
                                title={billingFreshnessChipTitle(fresh)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onApplyLiveStock(item.id, fresh.liveCapacity!);
                                }}
                              >
                                {billingFreshnessChipLabel(fresh)}
                              </button>
                            ) : (
                              <span
                                className="ds-chip ds-chip--sm bg-[var(--bg-tertiary)] text-[var(--content-tertiary)] border-[var(--border-subtle)] max-w-[11rem] text-left"
                                title={billingFreshnessChipTitle(fresh)}
                              >
                                {billingFreshnessChipLabel(fresh)}
                              </span>
                            )
                          )}
                          {isPartialInput ? (
                            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                ref={partialInputRef}
                                type="number"
                                value={partialQty}
                                onChange={(e) => setPartialQty(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    confirmPartial();
                                  }
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setPartialInputRow(null);
                                    setPartialQty('');
                                  }
                                }}
                                placeholder={`/${item.qty_requested}`}
                                min={0}
                                max={item.qty_requested}
                                className="ds-input w-16 text-right text-sm font-mono py-1 px-2"
                              />
                            </div>
                          ) : flag?.type === 'no_stock' ? (
                            <span className="ds-chip ds-chip--negative ds-chip--sm">
                              <XCircle size={12} weight="fill" />
                              No Stock
                            </span>
                          ) : flag?.type === 'partial' ? (
                            <span className="ds-chip ds-chip--warning ds-chip--sm">
                              <Warning size={12} weight="fill" />
                              {flag.availableQty}/{item.qty_requested}
                            </span>
                          ) : null}
                        </div>
                      </td>

                      <td className="text-center align-top pt-2 pr-2">
                        <button
                          type="button"
                          aria-label="Remove line"
                          className="p-2 rounded-lg text-[var(--content-negative)] hover:bg-[var(--bg-negative-subtle)] transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveLine(item.id);
                          }}
                        >
                          <Trash size={18} weight="bold" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={isClaiming}
            onClick={onOpenAddLine}
            className="group w-full h-11 rounded-xl border border-dashed border-[var(--border-accent)] bg-[var(--bg-accent-subtle)]/60 text-[var(--content-accent)] text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-[var(--bg-accent-subtle)] hover:border-solid transition-all disabled:opacity-50"
          >
            <Plus size={16} weight="bold" />
            <span>Add line</span>
            <kbd className="hidden sm:inline-flex font-mono bg-[var(--bg-primary)]/70 border border-[var(--border-accent)]/40 rounded-md px-1.5 py-0.5 text-[10px] font-medium ml-1 opacity-70 group-hover:opacity-100">
              A
            </kbd>
          </button>

          {showHints && (
            <div className="text-center animate-slide-up">
              <p className="font-ds-label-size text-[var(--content-quaternary)] flex flex-wrap justify-center gap-x-1 gap-y-1">
                <span>
                  <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">↑↓</kbd>{' '}
                  Navigate
                </span>
                <span className="text-[var(--border-opaque)]">·</span>
                <span>
                  <kbd className="font-mono bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)] rounded px-1.5 py-0.5 font-ds-micro text-[var(--content-warning)] font-semibold mx-0.5">F</kbd>{' '}
                  No stock
                </span>
                <span className="text-[var(--border-opaque)]">·</span>
                <span>
                  <kbd className="font-mono bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)] rounded px-1.5 py-0.5 font-ds-micro text-[var(--content-warning)] font-semibold mx-0.5">P</kbd>{' '}
                  Partial
                </span>
                <span className="text-[var(--border-opaque)]">·</span>
                <span>
                  <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">S</kbd>{' '}
                  Undo flag
                </span>
                <span className="text-[var(--border-opaque)]">·</span>
                <span>
                  <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">E</kbd>{' '}
                  Qty
                </span>
                <span className="text-[var(--border-opaque)]">·</span>
                <span>
                  <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">R</kbd>{' '}
                  Rate
                </span>
                <span className="text-[var(--border-opaque)]">·</span>
                <span>
                  <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">X</kbd>{' '}
                  Remove
                </span>
                <span className="text-[var(--border-opaque)]">·</span>
                <span>
                  <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">A</kbd>{' '}
                  Add line
                </span>
                <span className="text-[var(--border-opaque)]">·</span>
                <span>
                  <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">{SHORTCUT_COPY_ALL}</kbd>{' '}
                  Copy
                </span>
                <span className="text-[var(--border-opaque)]">·</span>
                <span>
                  <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">{SHORTCUT_FINISH}</kbd>{' '}
                  Finish
                </span>
              </p>
            </div>
          )}

        </div>
      </div>

      {lastRemoved && (
        <div className="shrink-0 px-4 lg:px-6 pt-3" role="status" aria-live="polite">
          <div className="max-w-3xl mx-auto flex items-center gap-3 rounded-2xl border border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] px-3 py-2.5 shadow-sm animate-slide-up">
            <span className="ds-chip ds-chip--sm shrink-0 bg-[var(--bg-negative)] text-white border-transparent">
              Removed
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--content-primary)] truncate">
                {lastRemoved.name}
              </p>
              <p className="font-ds-label-size text-[var(--content-tertiary)] tabular-nums">
                {lastRemoved.code ? (
                  <span className="font-mono">{lastRemoved.code}</span>
                ) : null}
                {lastRemoved.code ? <span className="px-1">·</span> : null}
                <span>
                  {lastRemoved.qty} ×{' '}
                  {lastRemoved.price != null ? formatCurrency(lastRemoved.price) : '—'}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleRestoreLine(lastRemoved.id)}
              className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-xs font-semibold bg-[var(--bg-primary)] border border-[var(--border-accent)] text-[var(--content-accent)] hover:opacity-90"
            >
              <ArrowCounterClockwise size={14} weight="bold" />
              Undo
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                if (lastRemovedTimerRef.current) clearTimeout(lastRemovedTimerRef.current);
                setLastRemoved(null);
              }}
              className="shrink-0 p-1.5 rounded-lg text-[var(--content-quaternary)] hover:text-[var(--content-secondary)] hover:bg-[var(--bg-primary)]"
            >
              <XCircle size={18} weight="bold" />
            </button>
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 lg:px-6 py-3">
        <div className="max-w-3xl mx-auto flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="ds-chip ds-chip--sm bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border-[var(--border-positive)] tabular-nums font-semibold">
              {billedNormalCount} to bill
            </span>
            {flagCount > 0 && (
              <span className="ds-chip ds-chip--sm bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] border-[var(--border-warning)] tabular-nums font-semibold">
                {flagCount} flagged
              </span>
            )}
            {editCount > 0 && (
              <span className="ds-chip ds-chip--sm bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border-[var(--border-accent)] tabular-nums font-semibold">
                {editCount} edited
              </span>
            )}
            {addedLinesSessionCount > 0 && (
              <span className="ds-chip ds-chip--sm bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border-[var(--border-positive)] tabular-nums font-semibold">
                {addedLinesSessionCount} added
              </span>
            )}
            {removedCount > 0 && (
              <span className="ds-chip ds-chip--sm bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] border-[var(--border-negative)] tabular-nums font-semibold">
                {removedCount} removed
              </span>
            )}
          </div>
          <div className="w-full mb-3">
            <FulfillmentPathSelector
              value={fulfillmentPath}
              onChange={setFulfillmentPath}
              stockLocationCode={stockLocationCode}
              pickLineCount={pickLineCount}
              disabled={isApproving || isRejecting || isClaiming}
              compact
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowReject(true)}
              disabled={isApproving || isRejecting}
              className="h-11 px-4 rounded-xl text-[var(--content-negative)] text-sm font-semibold hover:bg-[var(--bg-negative-subtle)] transition-all disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={handleFinishAttempt}
              disabled={
                isClaiming ||
                isApproving ||
                isRejecting ||
                mergedVisibleRows.length === 0
              }
              className="h-11 px-5 rounded-xl bg-[var(--role-primary)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all shadow-sm disabled:opacity-50 inline-flex items-center gap-2"
            >
              <span>
                {isClaiming ? 'Claiming…' : isApproving ? 'Approving…' : 'Finish Billing'}
              </span>
              {!isClaiming && !isApproving && (
                <kbd className="hidden sm:inline-flex font-mono bg-white/15 border border-white/25 rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
                  {SHORTCUT_FINISH}
                </kbd>
              )}
            </button>
          </div>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="ds-card p-6 max-w-md w-full max-h-[min(85vh,85dvh)] flex flex-col overflow-hidden shadow-xl animate-slide-up min-h-0"
            role="dialog"
            aria-modal="true"
            aria-labelledby="billing-finish-confirm-title"
          >
            <h3
              id="billing-finish-confirm-title"
              className="text-base font-bold text-[var(--content-primary)] mb-4 shrink-0"
            >
              Finish billing {orderName}?
            </h3>

            <div className="mb-4 shrink-0">
              <FulfillmentPathSelector
                value={fulfillmentPath}
                onChange={setFulfillmentPath}
                stockLocationCode={stockLocationCode}
                pickLineCount={pickLineCount}
                disabled={isApproving || isClaiming}
              />
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain space-y-2 mb-4 pr-1 -mr-0.5 [scrollbar-gutter:stable]"
              role="region"
              aria-label="Order summary"
            >
              {removedCount > 0 && (
                <p className="text-sm text-[var(--content-secondary)]">
                  {removedCount} line{removedCount !== 1 ? 's' : ''} marked removed on the sheet. Use{' '}
                  <span className="font-semibold text-[var(--content-primary)]">Undo remove</span> on those rows
                  if you need them back.
                </p>
              )}
              {addedLinesSessionCount > 0 && (
                <p className="text-sm text-[var(--content-positive)]">
                  {addedLinesSessionCount} new line{addedLinesSessionCount !== 1 ? 's' : ''} added this session.
                </p>
              )}
              {editCount > 0 && (
                <p className="text-sm text-[var(--content-accent)]">
                  {editCount} line{editCount !== 1 ? 's' : ''} edited (qty/rate).
                </p>
              )}
              {billedNormalCount > 0 && flagCount === 0 && (
                <p className="text-sm text-[var(--content-positive)] font-medium">
                  All {billedNormalCount} visible lines billed as ordered.
                </p>
              )}
              {billedNormalCount > 0 && flagCount > 0 && (
                <p className="text-sm text-[var(--content-positive)] font-medium">
                  {billedNormalCount} item{billedNormalCount !== 1 ? 's' : ''} billed normally
                </p>
              )}
              {Object.entries(flags)
                .filter(([, f]) => f.type === 'partial')
                .map(([idStr, f]) => {
                  const item = mergedVisibleRows.find((it) => it.id === Number(idStr));
                  return (
                    <p key={idStr} className="text-sm text-[var(--content-warning)]">
                      {item ? orderItemDisplayName(item) : ''} — {f.availableQty} of {item?.qty_requested}, rest pending
                    </p>
                  );
                })}
              {Object.entries(flags)
                .filter(([, f]) => f.type === 'no_stock')
                .map(([idStr]) => {
                  const item = mergedVisibleRows.find((it) => it.id === Number(idStr));
                  return (
                    <p key={idStr} className="text-sm text-[var(--content-negative)]">
                      {item ? orderItemDisplayName(item) : ''} — no stock, {item?.qty_requested} pending
                    </p>
                  );
                })}
            </div>

            <div className="shrink-0 border-t border-[var(--border-subtle)] pt-4 mt-0">
              <p className="font-ds-label-size text-[var(--content-quaternary)] mb-4">
                Out of stock items will be marked pending. Partial items billed at available qty.
              </p>

              <p className="font-ds-label-size text-[var(--content-quaternary)] mb-5 text-center sm:text-left">
                <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">{SHORTCUT_FINISH}</kbd>
                <span className="text-[var(--content-quaternary)]"> confirm</span>
                <span className="mx-1.5 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">Esc</kbd>
                <span className="text-[var(--content-quaternary)]"> cancel</span>
              </p>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 h-11 rounded-xl border border-[var(--border-opaque)] text-sm font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  ref={confirmFinishRef}
                  type="button"
                  onClick={confirmFinish}
                  disabled={isClaiming || isApproving || mergedVisibleRows.length === 0}
                  className="flex-1 h-11 rounded-xl bg-[var(--role-primary)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isClaiming ? 'Claiming…' : isApproving ? 'Approving...' : 'Confirm & Finish'}
                  {!isClaiming && !isApproving && (
                    <span className="font-ds-label-size font-normal opacity-80 hidden sm:inline tabular-nums">{SHORTCUT_FINISH}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="ds-card p-6 max-w-md w-full shadow-xl animate-slide-up"
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-base font-bold text-[var(--content-primary)] mb-2">
              Reject {orderName}?
            </h3>
            <p className="text-sm text-[var(--content-secondary)] mb-4">
              Enter a reason. Sales will be notified with this message.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Pricing mismatch, customer requested change..."
              className="w-full h-28 px-3 py-2 rounded-xl border border-[var(--border-opaque)] text-sm text-[var(--content-primary)] bg-[var(--bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--role-primary)]"
              autoFocus
            />
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowReject(false);
                  setRejectReason('');
                }}
                disabled={isRejecting}
                className="flex-1 h-11 rounded-xl border border-[var(--border-opaque)] text-sm font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRejectConfirm}
                disabled={isRejecting || !rejectReason.trim()}
                className="flex-1 h-11 rounded-xl bg-[var(--bg-negative)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isRejecting ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
