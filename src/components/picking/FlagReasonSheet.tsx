import { BottomSheet } from '../shared';
import { FLAG_REASONS, type FlagReason } from '../../utils/constants';
import { FLAG_SHEET_PRICE_HINT } from '../../lib/billing/mrpWorkflowCopy';

export interface FlagSubmitPayload {
  reason: FlagReason;
  notes: string | null;
}

interface FlagReasonSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: FlagSubmitPayload) => void;
  loading?: boolean;
  title?: string;
  hint?: string;
  /** Optional context shown above reason grid (e.g. short-pick remaining qty). */
  contextBanner?: string;
}

export function FlagReasonSheet({
  isOpen,
  onClose,
  onSubmit,
  loading = false,
  title = 'Report issue',
  hint = 'Billing will be notified. You can reset this line before leaving the order.',
  contextBanner,
}: FlagReasonSheetProps): React.JSX.Element {
  function resetAndClose() {
    onClose();
  }

  function submitReason(selected: FlagReason, noteText: string | null = null) {
    onSubmit({ reason: selected, notes: noteText });
  }

  function handleReasonSelect(selected: FlagReason) {
    if (loading) return;
    // One tap — opening the sheet is already deliberate; undo is available on the line.
    submitReason(selected, null);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={resetAndClose} title={title}>
      <div className="space-y-4">
        <p className="text-sm text-[var(--content-tertiary)]">{hint}</p>
        {contextBanner ? (
          <p className="rounded-lg border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-3 py-2 text-sm text-[var(--content-warning-on-light)]">
            {contextBanner}
          </p>
        ) : null}
        <p className="text-xs text-[var(--content-secondary)] rounded-lg bg-[var(--bg-tertiary)] px-3 py-2">
          {FLAG_SHEET_PRICE_HINT}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {FLAG_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => handleReasonSelect(r)}
              disabled={loading}
              className="px-3 py-3 rounded-xl text-sm font-medium text-left min-h-12 transition-colors bg-[var(--bg-tertiary)] text-[var(--content-secondary)] hover:bg-[var(--bg-negative-subtle)] hover:text-[var(--content-negative)] active:scale-[0.98] disabled:opacity-50"
            >
              {r}
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
