import type { BusyFinishAction } from '../../../lib/billing/busyFinishAction';
import { BillingWorkDock } from './BillingWorkDock';

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
  const primaryBlocked = finishAction.disabled || finishLoading;

  return (
    <BillingWorkDock
      billableCount={billableCount}
      qtyTotal={qtyTotal}
      skipCount={skipCount}
      specialRateCount={specialRateCount}
      focCount={focCount}
      pendingCount={pendingCount}
      onSpecialRateClick={onSpecialRateClick}
      onFocClick={onFocClick}
      onPendingClick={onPendingClick}
      copyLabel="Copy all items"
      onCopy={onCopy}
      copyDisabled={copyDisabled}
      copyJustCopied={copyJustCopied}
      hasCopiedOnce={hasCopiedOnce}
      primaryLabel={finishAction.label}
      onPrimary={onFinish}
      primaryDisabled={finishAction.disabled}
      primaryLoading={finishLoading}
      primaryWarning={primaryBlocked ? finishAction.gateWarning ?? null : null}
      primaryHint={!primaryBlocked ? finishAction.hint ?? null : null}
    />
  );
}
