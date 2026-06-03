import type { RejectionKind } from '../../types';

const DESCRIPTION_PLACEHOLDER =
  'e.g. Account locked, pricing mismatch, customer requested change…';

interface BillingRejectDialogProps {
  customerName: string;
  rejectKind: RejectionKind;
  rejectReason: string;
  isSubmitting: boolean;
  onRejectKindChange: (kind: RejectionKind) => void;
  onRejectReasonChange: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function BillingRejectDialog({
  customerName,
  rejectKind,
  rejectReason,
  isSubmitting,
  onRejectKindChange,
  onRejectReasonChange,
  onCancel,
  onConfirm,
}: BillingRejectDialogProps): React.JSX.Element {
  const reasonReady = rejectReason.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="ds-card p-6 max-w-md w-full shadow-xl animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-reject-title"
      >
        <h3
          id="billing-reject-title"
          className="text-base font-bold text-[var(--content-primary)] mb-2"
        >
          {customerName}
        </h3>
        <p className="text-sm text-[var(--content-secondary)] mb-4">
          Choose order on hold or order rejected. Add a description for the
          salesperson.
        </p>
        <div className="space-y-2 mb-4">
          <label className="flex items-start gap-3 rounded-xl border border-[var(--border-opaque)] p-3 cursor-pointer has-[:checked]:border-[var(--border-warning)] has-[:checked]:bg-[var(--bg-warning-subtle)]">
            <input
              type="radio"
              name="reject-kind"
              value="account_hold"
              checked={rejectKind === 'account_hold'}
              onChange={() => onRejectKindChange('account_hold')}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--content-primary)]">
                Order on hold
              </span>
              <span className="block text-xs text-[var(--content-secondary)] mt-0.5">
                Pauses billing — can be revived from History.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-[var(--border-opaque)] p-3 cursor-pointer has-[:checked]:border-[var(--border-negative)] has-[:checked]:bg-[var(--bg-negative-subtle)]">
            <input
              type="radio"
              name="reject-kind"
              value="terminal"
              checked={rejectKind === 'terminal'}
              onChange={() => onRejectKindChange('terminal')}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--content-primary)]">
                Order rejected
              </span>
              <span className="block text-xs text-[var(--content-secondary)] mt-0.5">
                Final — not returned to the billing queue.
              </span>
            </span>
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-[var(--content-secondary)]">
            Description
          </span>
          <textarea
            value={rejectReason}
            onChange={(e) => onRejectReasonChange(e.target.value)}
            placeholder={DESCRIPTION_PLACEHOLDER}
            className="mt-1.5 w-full h-28 px-3 py-2 rounded-xl border border-[var(--border-opaque)] text-sm text-[var(--content-primary)] bg-[var(--bg-primary)] placeholder:text-[var(--content-quaternary)] focus:outline-none focus:ring-2 focus:ring-[var(--role-primary)]"
            autoFocus
          />
        </label>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 h-11 rounded-xl border border-[var(--border-opaque)] text-sm font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting || !reasonReady}
            className="flex-1 h-11 rounded-xl bg-[var(--bg-negative)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {isSubmitting
              ? 'Saving...'
              : rejectKind === 'account_hold'
                ? 'Order on hold'
                : 'Order rejected'}
          </button>
        </div>
      </div>
    </div>
  );
}
