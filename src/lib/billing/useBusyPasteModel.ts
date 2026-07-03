import { useCallback, useMemo, useRef, useState } from 'react';
import { busyEntryLineNature } from './busyEntryLineNature';
import {
  markBusyEnteredIds,
  readBusyEnteredIds,
  toggleBusyEnteredId,
  writeBusyEnteredIds,
} from './busyEntrySession';
import { deriveBusyFinishAction, type BusyFinishAction } from './busyFinishAction';
import {
  busyBillableQty,
  isBusyBillableLine,
  isFullyPendingBusyLine,
} from './busyLineSplit';
import { buildBusyPasteText, sortBillLines } from './sortBillLines';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import type { BillingLineEdit, ItemFlag } from '../../hooks/useBillingFlow';
import type { OrderItem } from '../../types';

export interface UseBusyPasteModelOptions {
  orderId: number;
  items: OrderItem[];
  lineEdits: Record<number, BillingLineEdit>;
  flags: Record<number, ItemFlag>;
  enabled?: boolean;
  finishLabel?: string;
  finishDisabled?: boolean;
  finishLoading?: boolean;
  isClaiming?: boolean;
  isApproving?: boolean;
  isRejecting?: boolean;
  /** When false, finish stays disabled with "No items on sheet". Defaults to visible non-removed count. */
  hasVisibleRows?: boolean;
  /** No flags, edits, or line changes — finish without per-line Busy ticks. */
  cleanSheet?: boolean;
  copySessionId?: string;
}

export interface BusyPasteModel {
  billable: OrderItem[];
  skip: OrderItem[];
  enteredIds: Set<number>;
  enteredCount: number;
  billableCount: number;
  billableQtyTotal: number;
  specialRateCount: number;
  focCount: number;
  pendingCount: number;
  skipCount: number;
  finishAction: BusyFinishAction;
  toggleEntered: (lineId: number) => void;
  toggleAllEntered: () => void;
  copyBillable: () => void;
  copyJustCopied: boolean;
  hasCopiedOnce: boolean;
  registerLineRef: (lineId: number, el: HTMLLIElement | null) => void;
  scrollToLine: (lineId: number | undefined) => void;
  firstSpecialRateLineId: number | undefined;
  firstFocLineId: number | undefined;
  firstPendingLineId: number | undefined;
}

const EMPTY_MODEL: BusyPasteModel = {
  billable: [],
  skip: [],
  enteredIds: new Set(),
  enteredCount: 0,
  billableCount: 0,
  billableQtyTotal: 0,
  specialRateCount: 0,
  focCount: 0,
  pendingCount: 0,
  skipCount: 0,
  finishAction: {
    label: 'Send to pick',
    disabled: true,
    gateWarning: null,
    hint: null,
  },
  toggleEntered: () => {},
  toggleAllEntered: () => {},
  copyBillable: () => {},
  copyJustCopied: false,
  hasCopiedOnce: false,
  registerLineRef: () => {},
  scrollToLine: () => {},
  firstSpecialRateLineId: undefined,
  firstFocLineId: undefined,
  firstPendingLineId: undefined,
};

export function useBusyPasteModel({
  orderId,
  items,
  lineEdits,
  flags,
  enabled = true,
  finishLabel = 'Send to pick',
  finishDisabled = false,
  finishLoading = false,
  isClaiming = false,
  isApproving = false,
  isRejecting = false,
  hasVisibleRows,
  cleanSheet = false,
  copySessionId = 'busy-paste',
}: UseBusyPasteModelOptions): BusyPasteModel {
  const { copy, copiedId } = useCopyToClipboard();
  const [hasCopiedOnce, setHasCopiedOnce] = useState(false);

  const sorted = useMemo(() => sortBillLines(items), [items]);

  const billable = useMemo(
    () =>
      sorted.filter(
        (item) =>
          !lineEdits[item.id]?.removed &&
          isBusyBillableLine(item, flags[item.id], lineEdits[item.id]),
      ),
    [sorted, lineEdits, flags],
  );

  const skip = useMemo(
    () =>
      sorted.filter(
        (item) =>
          !lineEdits[item.id]?.removed && isFullyPendingBusyLine(flags[item.id]),
      ),
    [sorted, lineEdits, flags],
  );

  const [enteredIds, setEnteredIds] = useState(() => readBusyEnteredIds(orderId));

  const toggleEntered = useCallback(
    (lineId: number) => {
      setEnteredIds(toggleBusyEnteredId(orderId, lineId));
    },
    [orderId],
  );

  const copyBillable = useCallback(() => {
    if (billable.length === 0) return;
    void copy(buildBusyPasteText(billable, { lineEdits, flags }), copySessionId).then(
      (ok) => {
        if (ok) setHasCopiedOnce(true);
      },
    );
    setEnteredIds(markBusyEnteredIds(orderId, billable.map((row) => row.id)));
  }, [billable, flags, lineEdits, orderId, copy, copySessionId]);

  const toggleAllEntered = useCallback(() => {
    if (billable.length === 0) return;
    const next = readBusyEnteredIds(orderId);
    const allEntered = billable.every((row) => next.has(row.id));
    if (allEntered) {
      for (const row of billable) next.delete(row.id);
    } else {
      for (const row of billable) next.add(row.id);
    }
    writeBusyEnteredIds(orderId, next);
    setEnteredIds(next);
  }, [billable, orderId]);

  const enteredCount = billable.filter((item) => enteredIds.has(item.id)).length;

  const billableQtyTotal = useMemo(
    () =>
      billable.reduce(
        (sum, item) => sum + busyBillableQty(item, flags[item.id], lineEdits[item.id]),
        0,
      ),
    [billable, flags, lineEdits],
  );

  const specialRateRows = useMemo(
    () => billable.filter((item) => busyEntryLineNature(item) === 'special_rate'),
    [billable],
  );

  const focRows = useMemo(
    () => billable.filter((item) => busyEntryLineNature(item) === 'foc'),
    [billable],
  );

  const lineRefs = useRef<Record<number, HTMLLIElement | null>>({});

  const registerLineRef = useCallback((lineId: number, el: HTMLLIElement | null) => {
    lineRefs.current[lineId] = el;
  }, []);

  const scrollToLine = useCallback((lineId: number | undefined) => {
    if (lineId == null) return;
    requestAnimationFrame(() => {
      lineRefs.current[lineId]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }, []);

  const visibleRowCount = useMemo(
    () => sorted.filter((item) => !lineEdits[item.id]?.removed).length,
    [sorted, lineEdits],
  );

  const finishAction = deriveBusyFinishAction({
    billableCount: billable.length,
    enteredCount,
    skipCount: skip.length,
    isClaiming,
    isApproving: isApproving || finishLoading,
    isRejecting,
    hasVisibleRows: hasVisibleRows ?? visibleRowCount > 0,
    enabledLabel: finishLabel,
    copiedOnce: hasCopiedOnce,
    cleanSheet,
  });

  if (!enabled) return EMPTY_MODEL;

  return {
    billable,
    skip,
    enteredIds,
    enteredCount,
    billableCount: billable.length,
    billableQtyTotal,
    specialRateCount: specialRateRows.length,
    focCount: focRows.length,
    pendingCount: skip.length,
    skipCount: skip.length,
    finishAction: {
      ...finishAction,
      disabled: finishAction.disabled || finishDisabled,
    },
    toggleEntered,
    toggleAllEntered,
    copyBillable,
    copyJustCopied: copiedId === copySessionId,
    hasCopiedOnce,
    registerLineRef,
    scrollToLine,
    firstSpecialRateLineId: specialRateRows[0]?.id,
    firstFocLineId: focRows[0]?.id,
    firstPendingLineId: skip[0]?.id,
  };
}

export function busyPasteProgress(
  orderId: number,
  billableCount: number,
): { entered: number; total: number } {
  const entered = readBusyEnteredIds(orderId);
  const enteredInSet = [...entered].length;
  return {
    entered: Math.min(enteredInSet, billableCount),
    total: billableCount,
  };
}
