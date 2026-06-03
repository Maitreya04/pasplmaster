import { Gift, HourglassHigh, Tag } from '@phosphor-icons/react';
import { BillingHeaderChip } from '../shared/BillingHeaderChip';
import { BillingWorkStat } from '../shared/BillingWorkStat';

interface BusyEntryWorkHeaderProps {
  billableCount: number;
  qtyTotal: number;
  skipCount?: number;
  specialRateCount?: number;
  focCount?: number;
  pendingCount?: number;
  onSpecialRateClick?: () => void;
  onFocClick?: () => void;
  onPendingClick?: () => void;
  rightSlot?: React.ReactNode;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-IN');
}

export function BusyEntryWorkHeader({
  billableCount,
  qtyTotal,
  skipCount = 0,
  specialRateCount = 0,
  focCount = 0,
  pendingCount = 0,
  onSpecialRateClick,
  onFocClick,
  onPendingClick,
  rightSlot,
}: BusyEntryWorkHeaderProps): React.JSX.Element {
  const hasNothingToBill = billableCount === 0 && skipCount > 0;
  const hasExceptionChips =
    specialRateCount > 0 || focCount > 0 || pendingCount > 0 || hasNothingToBill;

  return (
    <div className="billing-work-header">
      <div className="billing-work-header__main">
        <div className="billing-work-header__stats">
          <BillingWorkStat label="Bill these items" value={billableCount} />
          <BillingWorkStat label="Qty total" value={qtyTotal} />
        </div>

        {hasExceptionChips ? (
          <>
            <span className="billing-work-header__rule" aria-hidden />
            <div className="billing-work-header__chips">
              {hasNothingToBill ? (
                <span className="font-ds-caption-size text-[var(--content-tertiary)]">
                  Nothing to bill today · {formatNumber(skipCount)} pending
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
          </>
        ) : null}
      </div>

      {rightSlot ? <div className="billing-work-header__action">{rightSlot}</div> : null}
    </div>
  );
}
