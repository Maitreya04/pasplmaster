export interface BusyFinishAction {
  /** Primary button label — always the action name, never instructions. */
  label: string;
  disabled: boolean;
  /** Gate warning shown to the left of the button when disabled. */
  gateWarning: string | null;
  /** Reserved for optional side context; finish CTA stays single-minded. */
  hint: string | null;
}

export function deriveBusyFinishAction({
  billableCount,
  enteredCount,
  skipCount: _skipCount = 0,
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
  /** Label when the gate is clear (default: Done — assign picker). */
  enabledLabel?: string;
}): BusyFinishAction {
  if (isClaiming) {
    return { label: 'Claiming…', disabled: true, gateWarning: null, hint: null };
  }
  if (isApproving || isRejecting) {
    return { label: enabledLabel, disabled: true, gateWarning: null, hint: null };
  }

  if (!hasVisibleRows) {
    return { label: enabledLabel, disabled: true, gateWarning: 'No lines on sheet', hint: null };
  }

  const remaining = Math.max(0, billableCount - enteredCount);
  const allBillableEntered = billableCount === 0 || remaining === 0;

  if (!allBillableEntered) {
    const gateWarning =
      remaining === 1
        ? 'Tick 1 more line in Busy'
        : `Tick ${remaining} more lines in Busy`;
    return { label: enabledLabel, disabled: true, gateWarning, hint: null };
  }

  void _skipCount;

  return { label: enabledLabel, disabled: false, gateWarning: null, hint: null };
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
  return [
    billableCount > 0 ? `${billableCount} to bill` : null,
    skipCount > 0 ? `${skipCount} pending` : null,
    editCount > 0 ? `${editCount} edited` : null,
    removedCount > 0 ? `${removedCount} removed` : null,
    addedCount > 0 ? `${addedCount} added` : null,
  ].filter((v): v is string => Boolean(v));
}
