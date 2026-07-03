import { Gift, HourglassHigh, Prohibit, Tag } from '@phosphor-icons/react';
import { BillingHeaderChip } from '../shared/BillingHeaderChip';
import { BillingWorkStat } from '../shared/BillingWorkStat';
import { CopyAllItemsButton } from './CopyAllItemsButton';

export interface BillingWorkDockProps {
  billableCount: number;
  qtyTotal: number;
  skipCount?: number;
  specialRateCount?: number;
  focCount?: number;
  pendingCount?: number;
  pickerOosCount?: number;
  onSpecialRateClick?: () => void;
  onFocClick?: () => void;
  onPendingClick?: () => void;
  onPickerOosClick?: () => void;
  copyLabel?: string;
  onCopy: () => void;
  copyDisabled?: boolean;
  copyJustCopied?: boolean;
  hasCopiedOnce?: boolean;
  primaryLabel?: string;
  onPrimary?: () => void;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  primaryWarning?: string | null;
  primaryHint?: string | null;
}

export function BillingWorkDock({
  billableCount,
  qtyTotal,
  skipCount = 0,
  specialRateCount = 0,
  focCount = 0,
  pendingCount = 0,
  pickerOosCount = 0,
  onSpecialRateClick,
  onFocClick,
  onPendingClick,
  onPickerOosClick,
  copyLabel = 'Copy for Busy',
  onCopy,
  copyDisabled = false,
  copyJustCopied = false,
  hasCopiedOnce = false,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  primaryLoading = false,
  primaryWarning = null,
  primaryHint = null,
}: BillingWorkDockProps): React.JSX.Element {
  const hasNothingToBill = billableCount === 0 && skipCount > 0;
  const hasExceptionChips =
    specialRateCount > 0 ||
    focCount > 0 ||
    pendingCount > 0 ||
    pickerOosCount > 0 ||
    hasNothingToBill;
  const primaryBlocked = primaryDisabled || primaryLoading;
  const gateMessage =
    primaryBlocked && primaryWarning
      ? primaryWarning
      : !primaryBlocked && primaryHint
        ? primaryHint
        : null;

  return (
    <div className="billing-busy-dock shrink-0">
      <div className="billing-busy-dock__row">
        <div className="billing-busy-dock__leading min-w-0">
          <div className="billing-busy-dock__stats">
            <BillingWorkStat label="Bill these items" value={billableCount} />
            <BillingWorkStat label="Qty total" value={qtyTotal} />
          </div>

          {hasExceptionChips ? (
            <>
              <span className="billing-busy-dock__divider" aria-hidden />
              <div className="billing-busy-dock__chips">
                {hasNothingToBill ? (
                  <span className="font-ds-caption-size whitespace-nowrap text-[var(--content-tertiary)]">
                    Nothing to bill today · {skipCount.toLocaleString('en-IN')} pending
                  </span>
                ) : null}
                <BillingHeaderChip
                  icon={Tag}
                  label="Special"
                  title="Special rate"
                  count={specialRateCount}
                  tone="accent"
                  compact
                  onClick={onSpecialRateClick}
                />
                <BillingHeaderChip
                  icon={Gift}
                  label="FOC"
                  title="FOC"
                  count={focCount}
                  tone="positive"
                  compact
                  onClick={onFocClick}
                />
                <BillingHeaderChip
                  icon={HourglassHigh}
                  label="Pending"
                  title="Pending stock"
                  count={pendingCount}
                  tone="warning"
                  compact
                  onClick={onPendingClick}
                />
                <BillingHeaderChip
                  icon={Prohibit}
                  label="Picker OOS"
                  title="Picker marked out of stock"
                  count={pickerOosCount}
                  tone="warning"
                  compact
                  onClick={onPickerOosClick}
                />
              </div>
            </>
          ) : null}
        </div>

        <span className="billing-busy-dock__divider billing-busy-dock__divider--actions" aria-hidden />

        <div className="billing-busy-dock__actions">
          {gateMessage ? (
            <span
              className={`font-ds-caption-size leading-normal max-w-[14rem] text-right ${
                primaryBlocked
                  ? 'text-[var(--content-warning-on-light)]'
                  : 'text-[var(--content-quaternary)] hidden sm:inline'
              }`}
              role="status"
            >
              {gateMessage}
            </span>
          ) : null}

          <CopyAllItemsButton
            label={copyLabel}
            disabled={copyDisabled || billableCount === 0}
            onClick={onCopy}
            justCopied={copyJustCopied}
            copyAgain={hasCopiedOnce && !copyJustCopied}
            size="cta"
          />

          {onPrimary && primaryLabel ? (
            <button
              type="button"
              onClick={onPrimary}
              disabled={primaryBlocked}
              aria-disabled={primaryBlocked}
              title={primaryBlocked ? primaryWarning ?? undefined : undefined}
              className="billing-busy-dock__primary"
            >
              {primaryLoading ? 'Working…' : primaryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
