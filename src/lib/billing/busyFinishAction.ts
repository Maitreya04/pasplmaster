export interface BusyFinishAction {
  /** Primary button label — always the action name, never instructions. */
  label: string;
  disabled: boolean;
  /** Gate warning shown to the left of the button when disabled. */
  gateWarning: string | null;
  /** Subtle context beside the button when ready to finish. */
  hint: string | null;
}

/** True when every visible line is deferred — no warehouse pick after approve. */
export function isSkipWarehousePick(billableCount: number, skipCount: number): boolean {
  return billableCount === 0 && skipCount > 0;
}

export function busyFinishEnabledLabel(
  billableCount: number,
  skipCount: number,
  defaultLabel = 'Done — assign picker',
): string {
  if (isSkipWarehousePick(billableCount, skipCount)) {
    return 'Done — record pending';
  }
  return defaultLabel;
}

export function deriveBusyFinishAction({
  billableCount,
  enteredCount,
  skipCount = 0,
  isClaiming = false,
  isApproving = false,
  isRejecting = false,
  hasVisibleRows = true,
  enabledLabel = 'Done — assign picker',
}: {
  billableCount: number;
  enteredCount: number;
  skipCount: number;
  isClaiming?: boolean;
  isApproving?: boolean;
  isRejecting?: boolean;
  hasVisibleRows?: boolean;
  /** Label when the gate is clear and pick lines exist (default: Done — assign picker). */
  enabledLabel?: string;
}): BusyFinishAction {
  const resolvedLabel = busyFinishEnabledLabel(billableCount, skipCount, enabledLabel);
  const noPickHint = isSkipWarehousePick(billableCount, skipCount)
    ? 'Nothing to bill today · no warehouse pick'
    : null;

  if (isClaiming) {
    return { label: 'Claiming…', disabled: true, gateWarning: null, hint: null };
  }
  if (isApproving || isRejecting) {
    return { label: resolvedLabel, disabled: true, gateWarning: null, hint: null };
  }

  if (!hasVisibleRows) {
    return { label: resolvedLabel, disabled: true, gateWarning: 'No items on sheet', hint: null };
  }

  const remaining = Math.max(0, billableCount - enteredCount);
  const allBillableEntered = billableCount === 0 || remaining === 0;

  if (!allBillableEntered) {
    const gateWarning =
      remaining === 1
        ? 'Tick 1 more item in Busy'
        : `Tick ${remaining} more items in Busy`;
    return { label: resolvedLabel, disabled: true, gateWarning, hint: null };
  }

  return { label: resolvedLabel, disabled: false, gateWarning: null, hint: noPickHint };
}

/** Footer / header sheet summary — operator language, not system jargon. */
export function busySheetSummaryParts({
  billableCount,
  skipCount,
  editCount,
  removedCount,
  addedCount,
}: {
  billableCount: number;
  skipCount: number;
  editCount: number;
  removedCount: number;
  addedCount: number;
}): string[] {
  const billablePart =
    billableCount > 0
      ? `${billableCount} to bill`
      : skipCount > 0
        ? 'Nothing to bill today'
        : null;

  return [
    billablePart,
    skipCount > 0 ? `${skipCount} pending` : null,
    editCount > 0 ? `${editCount} edited` : null,
    removedCount > 0 ? `${removedCount} removed` : null,
    addedCount > 0 ? `${addedCount} added` : null,
  ].filter((v): v is string => Boolean(v));
}
