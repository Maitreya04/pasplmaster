import { ArrowLeft } from '@phosphor-icons/react';
import { billingShell } from './billingShell';

interface BillingNavBarProps {
  onBack?: () => void;
  onReject?: () => void;
  backLabel?: string;
  rejectDisabled?: boolean;
}

export function BillingNavBar({
  onBack,
  onReject,
  backLabel = 'Queue',
  rejectDisabled = false,
}: BillingNavBarProps): React.JSX.Element {
  return (
    <div className={billingShell.nav}>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 min-h-11 -ml-1 px-2 py-1 rounded-md font-ds-body-size text-[var(--content-secondary)] hover:text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        >
          <ArrowLeft size={15} weight="bold" aria-hidden />
          {backLabel}
        </button>
      ) : (
        <div />
      )}

      {onReject ? (
        <button
          type="button"
          onClick={onReject}
          disabled={rejectDisabled}
          className="font-ds-body-size text-[var(--content-negative)] hover:underline disabled:opacity-40 transition-colors ml-auto min-h-11 px-2"
        >
          Reject
        </button>
      ) : null}
    </div>
  );
}
