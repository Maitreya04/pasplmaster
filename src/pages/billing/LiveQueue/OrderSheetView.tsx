import { useState, useEffect, useRef, useCallback, useMemo, type ReactElement } from 'react';
import {
  ArrowCounterClockwise,
  XCircle,
  Plus,
  NotePencil,
  ListChecks,
  Tag,
  Gift,
  ClockCounterClockwise,
} from '@phosphor-icons/react';
import { ACCOUNT_HOLD_NOTE } from '../../../lib/billing/rejectionKind';
import type { FulfillmentPath, OrderItem, RejectionKind, StockLocationCode } from '../../../types';
import { countEffectivePickLinesAfterBilling } from '../../../lib/billing/billLineOutcome';
import type { BillingLiveQueueFlag } from '../../../lib/billing/liveQueueDraft';
import { defaultFulfillmentPath } from '../../../lib/billing/fulfillmentPath';
import { FulfillmentPathSelector } from '../../../components/billing/FulfillmentPathSelector';
import type { BillingLineEdit, ItemFlag } from '../../../hooks/useBillingFlow';
import type { BillingFreshnessRow } from '../../../hooks/useBillingStockFreshness';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { getQuotedPrice } from '../../../lib/specialPricing';
import {
  formatCurrency,
  orderItemDisplayName,
  orderItemProductCode,
} from '../../../utils/formatters';
import { orderItemConfirmedMrp } from '../../../lib/billing/orderItemSplitGroups';
import {
  buildBusyPasteText,
  sortBillLines,
  sortFlagsByBillLine,
} from '../../../lib/billing/sortBillLines';
import {
  deriveBusyFinishAction,
} from '../../../lib/billing/busyFinishAction';
import {
  busyBillableQty,
  busyPendingQty,
  isBusyBillableLine,
  isFullyPendingBusyLine,
} from '../../../lib/billing/busyLineSplit';
import {
  markBusyEnteredIds,
  readBusyEnteredIds,
  toggleBusyEnteredId,
  writeBusyEnteredIds,
} from '../../../lib/billing/busyEntrySession';
import { BillingActionBar } from '../../../components/billing/chrome/BillingActionBar';
import { BillingBillHeader } from '../../../components/billing/chrome/BillingBillHeader';
import { BillingOrderChrome } from '../../../components/billing/chrome/BillingOrderChrome';
import {
  busyEntryBrandLabel,
  busyEntryLineNature,
} from '../../../lib/billing/busyEntryLineNature';
import {
  BusyEntryLineRow,
  BusyEntryTableHeader,
} from '../../../components/billing/busyEntry/BusyEntryLineRow';
import { BusyEntryCopyHint } from '../../../components/billing/busyEntry/BusyEntryCopyHint';
import { QueueSectionHeader } from '../../../components/shared/QueueSectionHeader';

/** UI labels for billing (Windows-first). Finish still works with Cmd+Enter on Mac. */
const SHORTCUT_COPY_ALL = 'Alt+C';
const SHORTCUT_FINISH = 'Ctrl+Enter';

interface OrderSheetViewProps {
  orderId: number;
  embedded?: boolean;
  orderName: string;
  orderNumber: string;
  salesperson: string | null;
  transportName?: string | null;
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
  onReject: (payload: { kind: RejectionKind; reason: string }) => void;
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

type WorkSummaryTone = 'default' | 'warning' | 'positive' | 'info';

function workSummaryToneClass(tone: WorkSummaryTone): string {
  switch (tone) {
    case 'warning':
      return 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]';
    case 'positive':
      return 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]';
    case 'info':
      return 'border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]';
    default:
      return 'border-[var(--border-opaque)] bg-[var(--bg-secondary)] text-[var(--content-primary)]';
  }
}

function WorkSummaryButton({
  icon,
  label,
  count,
  tone = 'default',
  disabled = false,
  onClick,
}: {
  icon: ReactElement;
  label: string;
  count: number;
  tone?: WorkSummaryTone;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled || count === 0}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 font-ds-caption-size font-semibold tabular-nums transition-colors ${
        workSummaryToneClass(tone)
      } disabled:cursor-default disabled:opacity-45 enabled:hover:brightness-[0.98]`}
      style={{ borderWidth: '0.5px' }}
    >
      {icon}
      <span>{label}</span>
      <span className="font-ds-body-size">{count}</span>
    </button>
  );
}

export function OrderSheetView({
  orderId,
  embedded = false,
  orderName,
  orderNumber,
  salesperson,
  transportName,
  customerAddress: _customerAddress,
  notes,
  city: _city,
  itemCount,
  totalValue: _totalValue,
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
  onEditLineRate: _onEditLineRate,
  onRemoveLine,
  onRestoreLine,
  onApplyLiveStock,
  onOpenAddLine,
  onFinish,
  onReject,
  onSkip,
}: OrderSheetViewProps): ReactElement {
  const { copy } = useCopyToClipboard();
  const trimmedNotes = notes?.trim() ?? '';

  const sortedItems = useMemo(() => sortBillLines(items), [items]);

  const visibleRows = useMemo(
    () => sortBillLines(items.filter((i) => !lineEdits[i.id]?.removed)),
    [items, lineEdits],
  );

  const mergedVisibleRows = useMemo(
    () => visibleRows.map((i) => mergeLine(i, lineEdits[i.id])),
    [visibleRows, lineEdits],
  );

  const pickLineCount = useMemo(
    () =>
      countEffectivePickLinesAfterBilling(
        mergedVisibleRows,
        flags as Record<number, BillingLiveQueueFlag>,
      ),
    [mergedVisibleRows, flags],
  );

  const autoFulfillmentPath = useMemo(
    () => defaultFulfillmentPath(stockLocationCode, pickLineCount),
    [stockLocationCode, pickLineCount],
  );
  const [manualFulfillmentPath, setManualFulfillmentPath] = useState<FulfillmentPath | null>(null);
  const [fulfillmentScopeKey, setFulfillmentScopeKey] = useState(
    () => `${orderNumber}:${pickLineCount}:${stockLocationCode ?? ''}`,
  );
  const nextFulfillmentScopeKey = `${orderNumber}:${pickLineCount}:${stockLocationCode ?? ''}`;
  if (nextFulfillmentScopeKey !== fulfillmentScopeKey) {
    setFulfillmentScopeKey(nextFulfillmentScopeKey);
    setManualFulfillmentPath(null);
  }
  const fulfillmentPath = manualFulfillmentPath ?? autoFulfillmentPath;

  const [copyState, setCopyState] = useState<CopyState>('ready');
  const [enteredIds, setEnteredIds] = useState(() => readBusyEnteredIds(orderId));

  const toggleEntered = useCallback(
    (lineId: number) => {
      setEnteredIds(toggleBusyEnteredId(orderId, lineId));
    },
    [orderId],
  );

  const billableRows = useMemo(
    () =>
      mergedVisibleRows.filter((item) =>
        isBusyBillableLine(item, flags[item.id], lineEdits[item.id]),
      ),
    [mergedVisibleRows, flags, lineEdits],
  );

  const skipRowCount = useMemo(
    () => mergedVisibleRows.filter((item) => isFullyPendingBusyLine(flags[item.id])).length,
    [mergedVisibleRows, flags],
  );

  /** Billable lines first, then skip/pending — avoids in-sort-order items appearing under skip header. */
  const tableItemOrder = useMemo(() => {
    const billable: OrderItem[] = [];
    const skip: OrderItem[] = [];
    const removed: OrderItem[] = [];
    for (const item of sortedItems) {
      if (lineEdits[item.id]?.removed) {
        removed.push(item);
      } else if (isFullyPendingBusyLine(flags[item.id])) {
        skip.push(item);
      } else {
        billable.push(item);
      }
    }
    return {
      items: [...billable, ...skip, ...removed],
      skipSectionStartId: skip[0]?.id ?? null,
    };
  }, [sortedItems, lineEdits, flags]);

  const copyBillable = useCallback(() => {
    if (billableRows.length === 0) return;
    copy(
      buildBusyPasteText(billableRows, { lineEdits, flags, includeRate: true }),
      'all-items',
    );
    setCopyState('copied');
  }, [billableRows, lineEdits, copy]);

  const markAllEntered = useCallback(() => {
    if (billableRows.length === 0) return;
    setEnteredIds(markBusyEnteredIds(orderId, billableRows.map((row) => row.id)));
  }, [billableRows, orderId]);

  const toggleAllEntered = useCallback(() => {
    if (billableRows.length === 0) return;
    const next = readBusyEnteredIds(orderId);
    const allEntered = billableRows.every((row) => next.has(row.id));
    if (allEntered) {
      for (const row of billableRows) next.delete(row.id);
    } else {
      for (const row of billableRows) next.add(row.id);
    }
    writeBusyEnteredIds(orderId, next);
    setEnteredIds(next);
  }, [billableRows, orderId]);

  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [showHints, setShowHints] = useState(false);
  const hintsTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasLongSalesNote = trimmedNotes.length > 120 || trimmedNotes.includes('\n');
  const [salesNoteExpanded, setSalesNoteExpanded] = useState(false);

  const [partialInputRow, setPartialInputRow] = useState<number | null>(null);
  const [partialQty, setPartialQty] = useState('');
  const partialInputRef = useRef<HTMLInputElement>(null);

  const [editingQtyRow, setEditingQtyRow] = useState<number | null>(null);
  const [qtyDraft, setQtyDraft] = useState('');

  const [showConfirm, setShowConfirm] = useState(false);
  const confirmFinishRef = useRef<HTMLButtonElement>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectKind, setRejectKind] = useState<RejectionKind>('account_hold');
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

  const visibleLastRemoved = useMemo(() => {
    if (!lastRemoved) return null;
    const stillRemoved = !!lineEdits[lastRemoved.id]?.removed;
    const stillPresent = items.some((i) => i.id === lastRemoved.id);
    if (!stillRemoved || !stillPresent) return null;
    return lastRemoved;
  }, [lastRemoved, lineEdits, items]);

  const flagCount = Object.keys(flags).length;
  const specialRateRows = useMemo(
    () => billableRows.filter((item) => busyEntryLineNature(item) === 'special_rate'),
    [billableRows],
  );
  const focRows = useMemo(
    () => billableRows.filter((item) => busyEntryLineNature(item) === 'foc'),
    [billableRows],
  );
  const pendingRows = useMemo(
    () => mergedVisibleRows.filter((item) => isFullyPendingBusyLine(flags[item.id])),
    [mergedVisibleRows, flags],
  );

  const removedCount = items.filter((i) => lineEdits[i.id]?.removed).length;
  const editCount = Object.entries(lineEdits).filter(
    ([, e]) =>
      !e.removed &&
      (e.qtyRequested !== undefined || e.priceQuoted !== undefined),
  ).length;

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const focusLineById = useCallback(
    (lineId: number | undefined) => {
      if (lineId == null) return;
      const rowIndex = mergedVisibleRows.findIndex((row) => row.id === lineId);
      if (rowIndex < 0) return;
      setActiveRow(rowIndex);
      requestAnimationFrame(() => {
        rowRefs.current[rowIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    },
    [mergedVisibleRows],
  );

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

  const copyAllItems = copyBillable;

  const sortedFlagEntries = useMemo(
    () => sortFlagsByBillLine(flags, items),
    [flags, items],
  );

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

  const handleUndoFlag = useCallback(
    (orderItemId: number) => {
      onClearFlag(orderItemId);
      showHintsTemporarily();
    },
    [onClearFlag, showHintsTemporarily],
  );

  const handleRejectConfirm = useCallback(() => {
    if (isRejecting) return;
    const trimmedReason = rejectReason.trim();
    if (rejectKind === 'terminal' && !trimmedReason) return;
    onReject({
      kind: rejectKind,
      reason: rejectKind === 'account_hold' ? trimmedReason || ACCOUNT_HOLD_NOTE : trimmedReason,
    });
  }, [rejectKind, rejectReason, isRejecting, onReject]);

  const billedNormalCount = mergedVisibleRows.filter((it) => !flags[it.id]).length;

  const billableForBusyCount = billableRows.length;
  const enteredCount = billableRows.filter((item) => enteredIds.has(item.id)).length;
  const busyProgress = {
    entered: enteredCount,
    total: billableForBusyCount,
    skipCount: skipRowCount,
  };
  const finishAction = deriveBusyFinishAction({
    billableCount: billableForBusyCount,
    enteredCount,
    skipCount: skipRowCount,
    isClaiming,
    isApproving,
    isRejecting,
    hasVisibleRows: mergedVisibleRows.length > 0,
    enabledLabel: 'Done — assign picker',
  });

  const linesToEnterTone =
    billableForBusyCount > 0 && enteredCount >= billableForBusyCount
      ? ('positive' as const)
      : ('warning' as const);

  const busyRemaining = Math.max(0, billableForBusyCount - enteredCount);
  const showCopyHint = copyState !== 'ready' && busyRemaining > 0;

  const billableTotal = useMemo(
    () =>
      billableRows.reduce((sum, item) => {
        const price = getQuotedPrice(item) ?? item.price_system ?? 0;
        return sum + price * item.qty_requested;
      }, 0),
    [billableRows],
  );

  const shellClass = embedded
    ? 'density-billing-work h-full min-h-0 bg-[var(--bg-secondary)] flex flex-col animate-slide-up overflow-hidden'
    : 'density-compact min-h-screen bg-[var(--bg-primary)] flex flex-col animate-slide-up';

  const tableClass = embedded
    ? 'ds-table ds-table--billing w-full'
    : 'ds-table ds-table--billing w-full max-w-3xl mx-auto';

  const bodyWrapClass = embedded
    ? 'flex flex-col min-h-0 gap-3 p-3'
    : 'max-w-3xl mx-auto px-4 lg:px-6 py-4 space-y-3';

  const copyButtonLabel =
    copyState === 'copied'
      ? 'Copied'
      : copyState === 'settled'
        ? 'Copy all items again'
        : 'Copy all items';

  return (
    <div className={shellClass}>
      <BillingOrderChrome
        stage="busy_entry"
        embedded={embedded}
        className="flex-1 min-h-0"
        showNavBar
        onBack={onSkip}
        onReject={() => setShowReject(true)}
        rejectDisabled={isApproving || isRejecting}
        context={{
          salesperson,
          createdAt,
          transportName,
          salesNote: trimmedNotes || null,
          busyProgress,
          lineCount: itemCount,
          pendingCount: skipRowCount > 0 ? skipRowCount : undefined,
        }}
        billHeader={
          <BillingBillHeader
            customerName={orderName}
            orderId={orderNumber}
            createdAt={createdAt}
            priority={priority}
            transportName={transportName}
          />
        }
        summaryStats={[
          {
            label: 'Billable total',
            value: formatCurrency(billableTotal),
          },
          {
            label: 'Lines to enter',
            value: `${enteredCount} of ${billableForBusyCount}`,
            tone: linesToEnterTone,
          },
          ...(skipRowCount > 0
            ? [
                {
                  label: 'Pending',
                  value: `${skipRowCount} skipped`,
                  tone: 'info' as const,
                },
              ]
            : []),
        ]}
        actions={
          <BillingActionBar
            secondaryCopyLabel="Copy all items"
            onSecondaryCopy={copyBillable}
            secondaryCopyDisabled={isClaiming || billableRows.length === 0}
            ghostLabel="Mark all entered"
            onGhostClick={markAllEntered}
            gateWarning={finishAction.gateWarning}
            primaryLabel={finishAction.label}
            primaryDisabled={finishAction.disabled}
            primaryLoading={isClaiming || isApproving}
            onPrimary={handleFinishAttempt}
          />
        }
      >
        <div className={bodyWrapClass}>
          <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] overflow-hidden">
            {trimmedNotes ? (
              <div className="grid grid-cols-[124px_minmax(0,1fr)] border-b border-[var(--border-faint)]">
                <div className="flex items-center gap-2 border-r border-[var(--border-faint)] bg-[var(--bg-secondary)] px-3 py-3">
                  <NotePencil size={16} weight="bold" className="text-[var(--content-warning-on-light)]" />
                  <span className="font-ds-micro font-semibold uppercase text-[var(--content-quaternary)]">
                    Sales note
                  </span>
                </div>
                <div className="min-w-0 px-4 py-3">
                  <p
                    className={`font-ds-body-size font-semibold leading-snug text-[var(--content-primary)] whitespace-pre-wrap ${
                      hasLongSalesNote && !salesNoteExpanded ? 'line-clamp-2' : ''
                    }`}
                  >
                    {trimmedNotes}
                  </p>
                  {hasLongSalesNote ? (
                    <button
                      type="button"
                      onClick={() => setSalesNoteExpanded((open) => !open)}
                      className="mt-1 font-ds-caption-size font-semibold text-[var(--content-warning-on-light)] hover:underline"
                    >
                      {salesNoteExpanded ? 'Show less' : 'Show full note'}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-[124px_minmax(0,1fr)]">
              <div className="flex items-center border-r border-[var(--border-faint)] bg-[var(--bg-secondary)] px-3 py-3">
                <span className="font-ds-micro font-semibold uppercase text-[var(--content-quaternary)]">
                  Bill focus
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                <WorkSummaryButton
                  icon={<ListChecks size={14} weight="bold" />}
                  label="Billable"
                  count={billableForBusyCount}
                  onClick={() => focusLineById(billableRows[0]?.id)}
                />
                <WorkSummaryButton
                  icon={<Tag size={14} weight="bold" />}
                  label="Special rate"
                  count={specialRateRows.length}
                  tone="warning"
                  onClick={() => focusLineById(specialRateRows[0]?.id)}
                />
                <WorkSummaryButton
                  icon={<Gift size={14} weight="bold" />}
                  label="FOC"
                  count={focRows.length}
                  tone="positive"
                  onClick={() => focusLineById(focRows[0]?.id)}
                />
                <WorkSummaryButton
                  icon={<ClockCounterClockwise size={14} weight="bold" />}
                  label="Pending"
                  count={pendingRows.length}
                  tone="info"
                  onClick={() => focusLineById(pendingRows[0]?.id)}
                />
              </div>
            </div>
          </section>

          <section
            className={`flex flex-col min-h-0 bg-[var(--bg-secondary)] ${
              embedded
                ? 'rounded-lg border border-[var(--border-subtle)] overflow-hidden'
                : 'rounded-xl border border-[var(--border-subtle)] overflow-hidden shadow-sm'
            }`}
          >
            <div className="sticky top-0 z-20 border-b border-[var(--border-faint)] bg-[var(--bg-primary)]">
              <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                <QueueSectionHeader
                  label="Items to enter"
                  count={billableRows.length}
                  description={
                    skipRowCount > 0
                      ? `${skipRowCount} pending below, not copied to Busy`
                      : undefined
                  }
                  variant="subtle"
                  className="py-0"
                />
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={copyBillable}
                    disabled={isClaiming || billableRows.length === 0}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 font-ds-caption-size font-semibold border transition-colors disabled:opacity-40 ${
                      copyState === 'copied'
                        ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
                        : 'border-[var(--content-primary)] bg-[var(--content-primary)] text-[var(--bg-primary)] hover:opacity-90'
                    }`}
                    style={{ borderWidth: '0.5px' }}
                  >
                    {copyButtonLabel}
                  </button>
                </div>
              </div>
            </div>
            {showCopyHint ? (
              <BusyEntryCopyHint remaining={busyRemaining} onMarkAllEntered={markAllEntered} />
            ) : null}
            <div className="overflow-x-auto min-w-0">
            <table className={tableClass}>
              <BusyEntryTableHeader
                enteredCount={enteredCount}
                totalCount={billableForBusyCount}
                onToggleAll={toggleAllEntered}
              />
              <tbody>
                {tableItemOrder.items.map((serverItem) => {
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
                        <td colSpan={6} className="py-2.5 px-3">
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
                  const isSkip = isFullyPendingBusyLine(flag);
                  const billableQty = busyBillableQty(item, flag, lineEdits[item.id]);
                  const pendingQty = busyPendingQty(item, flag, lineEdits[item.id]);
                  const entered = !isSkip && enteredIds.has(item.id);

                  const skipHeaderRow =
                    !removed &&
                    skipRowCount > 0 &&
                    serverItem.id === tableItemOrder.skipSectionStartId ? (
                      <tr key="skip-section-header">
                        <td colSpan={6} className="p-0 border-t border-[var(--border-opaque)]">
                          <QueueSectionHeader
                            label="Skip — pending"
                            count={skipRowCount}
                            variant="divider"
                            description="out of stock · not billed today"
                          />
                        </td>
                      </tr>
                    ) : null;

                  const isActive = activeRow === idx;
                  const billableLineNo = isSkip
                    ? item.bill_line_no ?? idx + 1
                    : billableRows.findIndex((row) => row.id === item.id) + 1;
                  const isPartialInput = partialInputRow === idx;
                  const fresh = freshnessMap?.[item.id];
                  const serverQty = serverItem.qty_requested;
                  const qtyEdited =
                    lineEdits[item.id]?.qtyRequested != null &&
                    lineEdits[item.id]!.qtyRequested !== serverQty;

                  const isNew = sessionNewOrderItemIds?.has(item.id);
                  const isEdited = qtyEdited && !isNew;
                  const nature = busyEntryLineNature(item);
                  const brandName = busyEntryBrandLabel(item);

                  const labelMrp = orderItemConfirmedMrp(item);
                  const isSplitSibling = item.split_from_id != null;

                  return (
                    <>
                      {skipHeaderRow}
                      <BusyEntryLineRow
                        key={item.id}
                        item={item}
                        lineNo={billableLineNo > 0 ? billableLineNo : idx + 1}
                        isActive={isActive}
                        isSkip={isSkip}
                        entered={entered}
                        flag={flag}
                        nature={nature}
                        brandName={brandName}
                        isSplitSibling={isSplitSibling}
                        isNew={!!isNew}
                        isEdited={isEdited}
                        labelMrp={labelMrp}
                        fresh={fresh}
                        editingQty={editingQtyRow === idx}
                        qtyDraft={qtyDraft}
                        serverQty={serverQty}
                        qtyEdited={qtyEdited}
                        isPartialInput={isPartialInput}
                        partialQty={partialQty}
                        billableQty={billableQty}
                        pendingQty={pendingQty}
                        partialInputRef={partialInputRef}
                        rowRef={(el) => {
                          rowRefs.current[idx] = el;
                        }}
                        onRowClick={() => {
                          if (!isSkip) toggleEntered(item.id);
                          setActiveRow(idx);
                          showHintsTemporarily();
                        }}
                        onToggleEntered={() => toggleEntered(item.id)}
                        onUndoFlag={() => handleUndoFlag(item.id)}
                        onRemove={() => handleRemoveLine(item.id)}
                        onQtyEditStart={() => {
                          setEditingQtyRow(idx);
                          setQtyDraft(String(item.qty_requested));
                        }}
                        onQtyDraftChange={setQtyDraft}
                        onQtyCommit={commitQtyEdit}
                        onQtyCancel={() => {
                          setEditingQtyRow(null);
                          setQtyDraft('');
                        }}
                        onPartialConfirm={confirmPartial}
                        onPartialCancel={() => {
                          setPartialInputRow(null);
                          setPartialQty('');
                        }}
                        onPartialQtyChange={setPartialQty}
                        onApplyLiveStock={
                          fresh?.canApplyLive && fresh.liveCapacity != null
                            ? () => void onApplyLiveStock(item.id, fresh.liveCapacity!)
                            : undefined
                        }
                      />
                    </>
                  );
                })}
              </tbody>
            </table>
            </div>
            <div className={`border-t border-[var(--border-faint)] ${embedded ? 'px-4' : 'px-3'} py-2.5`}>
              <button
                type="button"
                disabled={isClaiming}
                onClick={onOpenAddLine}
                className="group w-full h-8 rounded-md border border-dashed border-[var(--border-subtle)] text-[var(--content-secondary)] font-ds-caption-size font-medium inline-flex items-center justify-center gap-1.5 hover:border-[var(--border-opaque)] hover:bg-[var(--bg-primary)] transition-colors disabled:opacity-50"
              >
                <Plus size={14} weight="bold" />
                <span>Add line</span>
                <kbd className="hidden sm:inline-flex font-mono bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-[10px] font-medium ml-1 opacity-70 group-hover:opacity-100">
                  A
                </kbd>
              </button>
            </div>
          </section>

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
      </BillingOrderChrome>

      {visibleLastRemoved && (
        <div className="shrink-0 px-4 lg:px-6 pt-3" role="status" aria-live="polite">
          <div className="max-w-3xl mx-auto flex items-center gap-3 rounded-2xl border border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] px-3 py-2.5 shadow-sm animate-slide-up">
            <span className="ds-chip ds-chip--sm shrink-0 bg-[var(--bg-negative)] text-white border-transparent">
              Removed
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--content-primary)] truncate">
                {visibleLastRemoved.name}
              </p>
              <p className="font-ds-label-size text-[var(--content-tertiary)] tabular-nums">
                {visibleLastRemoved.code ? (
                  <span className="font-mono">{visibleLastRemoved.code}</span>
                ) : null}
                {visibleLastRemoved.code ? <span className="px-1">·</span> : null}
                <span>
                  {visibleLastRemoved.qty} ×{' '}
                  {visibleLastRemoved.price != null ? formatCurrency(visibleLastRemoved.price) : '—'}
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleRestoreLine(visibleLastRemoved.id)}
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
                onChange={setManualFulfillmentPath}
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
                  {editCount} line{editCount !== 1 ? 's' : ''} edited (qty).
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
              {sortedFlagEntries
                .filter(([, f]) => f.type === 'partial')
                .map(([orderItemId, f]) => {
                  const item = mergedVisibleRows.find((it) => it.id === orderItemId);
                  return (
                    <p key={orderItemId} className="text-sm text-[var(--content-warning)]">
                      {item ? orderItemDisplayName(item) : ''} — {f.availableQty} of {item?.qty_requested}, rest pending
                    </p>
                  );
                })}
              {sortedFlagEntries
                .filter(([, f]) => f.type === 'no_stock')
                .map(([orderItemId]) => {
                  const item = mergedVisibleRows.find((it) => it.id === orderItemId);
                  return (
                    <p key={orderItemId} className="text-sm text-[var(--content-negative)]">
                      {item ? orderItemDisplayName(item) : ''} — no stock, {item?.qty_requested} pending
                    </p>
                  );
                })}
            </div>

            <div className="shrink-0 border-t border-[var(--border-subtle)] pt-4 mt-0">
              <p className="font-ds-label-size text-[var(--content-quaternary)] mb-4">
                {pickLineCount <= 0
                  ? 'Nothing to pick — order will direct-bill only; pending lines go to the pending queue.'
                  : 'Out of stock items will be marked pending. Partial items billed at available qty.'}
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
              Choose why billing cannot process this order. Sales will be notified.
            </p>
            <div className="space-y-2 mb-4">
              <label className="flex items-start gap-3 rounded-xl border border-[var(--border-opaque)] p-3 cursor-pointer has-[:checked]:border-[var(--border-warning)] has-[:checked]:bg-[var(--bg-warning-subtle)]">
                <input
                  type="radio"
                  name="reject-kind"
                  value="account_hold"
                  checked={rejectKind === 'account_hold'}
                  onChange={() => setRejectKind('account_hold')}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-[var(--content-primary)]">
                    Account locked
                  </span>
                  <span className="block text-xs text-[var(--content-secondary)] mt-0.5">
                    On hold until the account is unlocked. Can be revived from History.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-[var(--border-opaque)] p-3 cursor-pointer has-[:checked]:border-[var(--border-negative)] has-[:checked]:bg-[var(--bg-negative-subtle)]">
                <input
                  type="radio"
                  name="reject-kind"
                  value="terminal"
                  checked={rejectKind === 'terminal'}
                  onChange={() => setRejectKind('terminal')}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-[var(--content-primary)]">
                    Other reason
                  </span>
                  <span className="block text-xs text-[var(--content-secondary)] mt-0.5">
                    Final rejection — not returned to the billing queue.
                  </span>
                </span>
              </label>
            </div>
            {rejectKind === 'account_hold' ? (
              <p className="text-xs text-[var(--content-tertiary)] mb-3 rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
                {ACCOUNT_HOLD_NOTE}
              </p>
            ) : (
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Pricing mismatch, customer requested change..."
                className="w-full h-28 px-3 py-2 rounded-xl border border-[var(--border-opaque)] text-sm text-[var(--content-primary)] bg-[var(--bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--role-primary)]"
                autoFocus
              />
            )}
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowReject(false);
                  setRejectReason('');
                  setRejectKind('account_hold');
                }}
                disabled={isRejecting}
                className="flex-1 h-11 rounded-xl border border-[var(--border-opaque)] text-sm font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRejectConfirm}
                disabled={
                  isRejecting || (rejectKind === 'terminal' && !rejectReason.trim())
                }
                className="flex-1 h-11 rounded-xl bg-[var(--bg-negative)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isRejecting
                  ? 'Saving...'
                  : rejectKind === 'account_hold'
                    ? 'Place on hold'
                    : 'Confirm reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
