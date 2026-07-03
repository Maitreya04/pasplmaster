import { useState, useEffect, useRef, useCallback, useMemo, type ReactElement } from 'react';
import {
  ArrowCounterClockwise,
  XCircle,
  Plus,
  NotePencil,
} from '@phosphor-icons/react';
import { BillingRejectDialog } from '../../../components/billing/BillingRejectDialog';
import type {
  FulfillmentPath,
  OrderItem,
  RejectionKind,
  StockLocationCode,
} from '../../../types';
import { countEffectivePickLinesAfterBilling } from '../../../lib/billing/billLineOutcome';
import type { BillingLiveQueueFlag } from '../../../lib/billing/liveQueueDraft';
import { defaultFulfillmentPath, fulfillmentPathLabel } from '../../../lib/billing/fulfillmentPath';
import { FulfillmentPathSelector } from '../../../components/billing/FulfillmentPathSelector';
import type { BillingLineEdit, ItemFlag } from '../../../hooks/useBillingFlow';
import type { BillingFreshnessRow } from '../../../hooks/useBillingStockFreshness';
import { getQuotedPrice } from '../../../lib/specialPricing';
import {
  formatCurrency,
  orderItemDisplayName,
  orderItemProductCode,
} from '../../../utils/formatters';
import { orderItemConfirmedMrp } from '../../../lib/billing/orderItemSplitGroups';
import { sortBillLines, sortFlagsByBillLine } from '../../../lib/billing/sortBillLines';
import { isSkipWarehousePick } from '../../../lib/billing/busyFinishAction';
import {
  busyBillableQty,
  busyPendingQty,
  isFullyPendingBusyLine,
} from '../../../lib/billing/busyLineSplit';
import { useBusyPasteModel } from '../../../lib/billing/useBusyPasteModel';
import { BillingBillHeader } from '../../../components/billing/chrome/BillingBillHeader';
import { BillingOrderChrome } from '../../../components/billing/chrome/BillingOrderChrome';
import { BillingBusyDock } from '../../../components/billing/busyEntry/BillingBusyDock';
import {
  busyEntryBrandLabel,
  busyEntryLineNature,
} from '../../../lib/billing/busyEntryLineNature';
import {
  BusyEntryLineRow,
  BusyEntryTableHeader,
} from '../../../components/billing/busyEntry/BusyEntryLineRow';
import { BusyBillableEmptyState } from '../../../components/billing/busyEntry/BusyBillableEmptyState';
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

function mergeLine(item: OrderItem, edit?: BillingLineEdit): OrderItem {
  if (!edit || edit.removed) return item;
  return {
    ...item,
    qty_requested: edit.qtyRequested ?? item.qty_requested,
    price_quoted: edit.priceQuoted ?? item.price_quoted,
    sales_unit: edit.salesUnit ?? item.sales_unit,
  };
}

export function OrderSheetView({
  orderId,
  embedded = false,
  orderName,
  orderNumber,
  salesperson,
  transportName,
  customerAddress,
  notes,
  city,
  itemCount,
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
  onRemoveLine,
  onRestoreLine,
  onApplyLiveStock,
  onOpenAddLine,
  onFinish,
  onReject,
  onSkip,
}: OrderSheetViewProps): ReactElement {
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
  const finishLabel = fulfillmentPathLabel(fulfillmentPath);

  const cleanSheet =
    Object.keys(flags).length === 0 &&
    Object.entries(lineEdits).filter(
      ([, e]) =>
        !e.removed && (e.qtyRequested !== undefined || e.priceQuoted !== undefined),
    ).length === 0 &&
    items.filter((i) => lineEdits[i.id]?.removed).length === 0 &&
    addedLinesSessionCount === 0;

  const busyModel = useBusyPasteModel({
    orderId,
    items,
    lineEdits,
    flags,
    isClaiming,
    isApproving,
    isRejecting,
    hasVisibleRows: mergedVisibleRows.length > 0,
    cleanSheet,
    finishLabel,
    copySessionId: 'all-items',
  });

  const skipRowCount = busyModel.skipCount;
  const enteredIds = busyModel.enteredIds;
  const toggleEntered = busyModel.toggleEntered;
  const toggleAllEntered = busyModel.toggleAllEntered;
  const copyBillable = busyModel.copyBillable;
  const copyAllItems = busyModel.copyBillable;
  const enteredCount = busyModel.enteredCount;
  const billableForBusyCount = busyModel.billableCount;
  const billableQtyTotal = busyModel.billableQtyTotal;
  const finishAction = busyModel.finishAction;

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
    [mergedVisibleRows, setActiveRow],
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

  const sortedFlagEntries = useMemo(
    () => sortFlagsByBillLine(flags, items),
    [flags, items],
  );

  const showHintsTemporarily = useCallback(() => {
    setShowHints(true);
    if (hintsTimeoutRef.current) clearTimeout(hintsTimeoutRef.current);
    hintsTimeoutRef.current = setTimeout(() => setShowHints(false), 10_000);
  }, [setShowHints]);

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

      if (e.code === 'Space' && activeRow !== null && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const rowItem = mergedVisibleRows[activeRow];
        if (rowItem && !isFullyPendingBusyLine(flags[rowItem.id])) {
          toggleEntered(rowItem.id);
          showHintsTemporarily();
        }
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
    toggleEntered,
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
    if (!trimmedReason) return;
    onReject({ kind: rejectKind, reason: trimmedReason });
  }, [rejectKind, rejectReason, isRejecting, onReject]);

  const billedNormalCount = mergedVisibleRows.filter((it) => !flags[it.id]).length;

  const busyProgress = {
    entered: enteredCount,
    total: billableForBusyCount,
    skipCount: skipRowCount,
  };

  const skipWarehousePick = isSkipWarehousePick(billableForBusyCount, skipRowCount);

  const shellClass = embedded
    ? 'density-billing-work h-full min-h-0 bg-[var(--bg-secondary)] flex flex-col animate-slide-up overflow-hidden'
    : 'density-compact min-h-screen bg-[var(--bg-primary)] flex flex-col animate-slide-up';

  const tableClass = embedded
    ? 'ds-table ds-table--billing w-full min-w-[40rem]'
    : 'ds-table ds-table--billing w-full min-w-[40rem] max-w-[min(100%,72rem)] mx-auto';

  const bodyWrapClass = embedded
    ? 'flex flex-col min-h-0 gap-2 p-3'
    : 'w-full max-w-[min(100%,72rem)] mx-auto px-4 lg:px-6 py-4 space-y-2';

  return (
    <div className={shellClass}>
      <BillingOrderChrome
        stage="busy_entry"
        embedded={embedded}
        className="flex-1 min-h-0"
        skipWarehousePick={skipWarehousePick}
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
            customerCity={city}
            customerAddress={customerAddress}
            orderId={orderNumber}
            createdAt={createdAt}
            priority={priority}
            transportName={transportName}
          />
        }
        actions={
          <BillingBusyDock
            billableCount={billableForBusyCount}
            qtyTotal={billableQtyTotal}
            skipCount={skipRowCount}
            specialRateCount={busyModel.specialRateCount}
            focCount={busyModel.focCount}
            pendingCount={busyModel.pendingCount}
            finishAction={finishAction}
            onCopy={copyBillable}
            copyJustCopied={busyModel.copyJustCopied}
            hasCopiedOnce={busyModel.hasCopiedOnce}
            onFinish={handleFinishAttempt}
            onSpecialRateClick={() => focusLineById(busyModel.firstSpecialRateLineId)}
            onFocClick={() => focusLineById(busyModel.firstFocLineId)}
            onPendingClick={() => focusLineById(busyModel.firstPendingLineId)}
            copyDisabled={isClaiming}
            finishLoading={isClaiming || isApproving}
          />
        }
      >
        <div className={bodyWrapClass}>
          {trimmedNotes ? (
            <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] overflow-hidden">
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
            </section>
          ) : null}

          <section
            className={`flex flex-col min-h-0 bg-[var(--bg-secondary)] ${
              embedded
                ? 'rounded-lg border border-[var(--border-subtle)] overflow-hidden'
                : 'rounded-xl border border-[var(--border-subtle)] overflow-hidden shadow-sm'
            }`}
          >
            <div className="busy-entry-lines overflow-x-auto min-w-0">
            {billableForBusyCount === 0 && skipRowCount > 0 ? (
              <BusyBillableEmptyState skipCount={skipRowCount} />
            ) : null}
            <table className={tableClass}>
              {billableForBusyCount > 0 ? (
                <BusyEntryTableHeader
                  enteredCount={enteredCount}
                  totalCount={billableForBusyCount}
                  onToggleAll={toggleAllEntered}
                />
              ) : null}
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
                        <td colSpan={4} className="py-2.5 px-3">
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
                        <td colSpan={4} className="p-0 border-t border-[var(--border-opaque)]">
                          <QueueSectionHeader
                            label="Pending stock"
                            count={skipRowCount}
                            variant="divider"
                            description="out of stock · not billed today"
                          />
                        </td>
                      </tr>
                    ) : null;

                  const isActive = activeRow === idx;
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
                        lineEdit={lineEdits[item.id]}
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

      {showReject ? (
        <BillingRejectDialog
          customerName={orderName}
          rejectKind={rejectKind}
          rejectReason={rejectReason}
          isSubmitting={isRejecting}
          onRejectKindChange={setRejectKind}
          onRejectReasonChange={setRejectReason}
          onCancel={() => {
            setShowReject(false);
            setRejectReason('');
            setRejectKind('account_hold');
          }}
          onConfirm={handleRejectConfirm}
        />
      ) : null}
    </div>
  );
}
