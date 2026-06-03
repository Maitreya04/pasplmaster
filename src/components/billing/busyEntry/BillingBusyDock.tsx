import { Gift, HourglassHigh, Tag } from '@phosphor-icons/react';
import type { BusyFinishAction } from '../../../lib/billing/busyFinishAction';
import { BillingHeaderChip } from '../shared/BillingHeaderChip';
import { BillingWorkStat } from '../shared/BillingWorkStat';
import { CopyAllItemsButton } from './CopyAllItemsButton';

export interface BillingBusyDockProps {
  billableCount: number;
  qtyTotal: number;
  skipCount?: number;
  specialRateCount?: number;
  focCount?: number;
  pendingCount?: number;
  finishAction: BusyFinishAction;
  onCopy: () => void;
  onFinish: () => void;
  onSpecialRateClick?: () => void;
  onFocClick?: () => void;
  onPendingClick?: () => void;
  copyDisabled?: boolean;
  copyJustCopied?: boolean;
  hasCopiedOnce?: boolean;
  finishLoading?: boolean;
}

export function BillingBusyDock({
  billableCount,
  qtyTotal,
  skipCount = 0,
  specialRateCount = 0,
  focCount = 0,
  pendingCount = 0,
  finishAction,
  onCopy,
  onFinish,
  onSpecialRateClick,
  onFocClick,
  onPendingClick,
  copyDisabled = false,
  copyJustCopied = false,
  hasCopiedOnce = false,
  finishLoading = false,
}: BillingBusyDockProps): React.JSX.Element {
  const hasNothingToBill = billableCount === 0 && skipCount > 0;
  const hasExceptionChips =
    specialRateCount > 0 || focCount > 0 || pendingCount > 0 || hasNothingToBill;
  const primaryBlocked = finishAction.disabled || finishLoading;
  const gateMessage =
    primaryBlocked && finishAction.gateWarning
      ? finishAction.gateWarning
      : !primaryBlocked && finishAction.hint
        ? finishAction.hint
        : null;

  return (
    <div className="billing-busy-dock shrink-0">
      <div className="billing-busy-dock__row">
        <div className="billing-busy-dock__leading min-w-0">
          {hasExceptionChips ? (
            <>
              <div className="billing-busy-dock__chips">
                {hasNothingToBill ? (
                  <span className="font-ds-caption-size text-[var(--content-tertiary)]">
                    Nothing to bill today · {skipCount.toLocaleString('en-IN')} pending
                  </span>
                ) : null}
                <BillingHeaderChip
                  icon={Tag}
                  label="Special rate"
                  count={specialRateCount}
                  tone="accent"
                  onClick={onSpecialRateClick}
                />
                <BillingHeaderChip
                  icon={Gift}
                  label="FOC"
                  count={focCount}
                  tone="positive"
                  onClick={onFocClick}
                />
                <BillingHeaderChip
                  icon={HourglassHigh}
                  label="Pending stock"
                  count={pendingCount}
                  tone="warning"
                  onClick={onPendingClick}
                />
              </div>
              <span className="billing-busy-dock__divider" aria-hidden />
            </>
          ) : null}

          <div className="billing-busy-dock__stats">
            <BillingWorkStat label="Bill these items" value={billableCount} />
            <BillingWorkStat label="Qty total" value={qtyTotal} />
          </div>
        </div>

        <span className="billing-busy-dock__divider billing-busy-dock__divider--actions" aria-hidden />

        <div className="billing-busy-dock__actions">
          {gateMessage ? (
            <span className="sr-only" role="status">
              {gateMessage}
            </span>
          ) : null}

          <CopyAllItemsButton
            disabled={copyDisabled || billableCount === 0}
            onClick={onCopy}
            justCopied={copyJustCopied}
            copyAgain={hasCopiedOnce && !copyJustCopied}
            size="cta"
          />

          <button
            type="button"
            onClick={onFinish}
            disabled={primaryBlocked}
            aria-disabled={primaryBlocked}
            title={primaryBlocked ? finishAction.gateWarning ?? undefined : undefined}
            className="billing-busy-dock__primary"
          >
            {finishLoading ? 'Working…' : finishAction.label}
          </button>
        </div>
      </div>
    </div>
  );
}
