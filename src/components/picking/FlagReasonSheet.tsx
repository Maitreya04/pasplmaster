import { useState } from 'react';
import { Flag } from '@phosphor-icons/react';
import { BottomSheet, BigButton } from '../shared';
import { FLAG_REASONS, type FlagReason } from '../../utils/constants';

export interface FlagSubmitPayload {
  reason: FlagReason;
  notes: string | null;
  boxPrice: number | null;
}

interface FlagReasonSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: FlagSubmitPayload) => void;
  loading?: boolean;
}

export function FlagReasonSheet({
  isOpen,
  onClose,
  onSubmit,
  loading = false,
}: FlagReasonSheetProps): React.JSX.Element {
  const [reason, setReason] = useState<FlagReason | ''>('');
  const [notes, setNotes] = useState('');
  const [boxPrice, setBoxPrice] = useState('');
  const [notesExpanded, setNotesExpanded] = useState(false);

  function resetAndClose() {
    setReason('');
    setNotes('');
    setBoxPrice('');
    setNotesExpanded(false);
    onClose();
  }

  function handleSubmit() {
    if (!reason) return;
    if (reason === 'Price Mismatch') {
      const raw = boxPrice.trim();
      if (!raw) return;
      const parsed = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      onSubmit({ reason, notes: notes.trim() || null, boxPrice: parsed });
    } else {
      onSubmit({ reason, notes: notes.trim() || null, boxPrice: null });
    }
    setReason('');
    setNotes('');
    setBoxPrice('');
    setNotesExpanded(false);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={resetAndClose} title="Report issue">
      <div className="space-y-4">
        <p className="text-sm text-[var(--content-tertiary)]">
          Choose a reason. Billing will be notified — this cannot be undone from picking.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {FLAG_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`px-3 py-3 rounded-xl text-sm font-medium text-left min-h-12 transition-colors ${
                reason === r
                  ? 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] ring-1 ring-[var(--border-negative)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {reason === 'Price Mismatch' && (
          <div className="space-y-1">
            <p className="text-xs text-[var(--content-secondary)]">
              Enter the price printed on the box.
            </p>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--content-tertiary)]">
                ₹
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={boxPrice}
                onChange={(e) => setBoxPrice(e.target.value)}
                placeholder="Box price"
                className="w-full pl-7 pr-3 py-3 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-primary)] border border-[var(--border-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--border-negative)]"
              />
            </div>
          </div>
        )}

        {reason === 'Out of Stock' && (
          <p className="text-xs text-[var(--content-secondary)] rounded-lg bg-[var(--bg-tertiary)] px-3 py-2">
            We&apos;ll also add this to pending items so it can be re-ordered.
          </p>
        )}

        {!notesExpanded ? (
          <button
            type="button"
            onClick={() => setNotesExpanded(true)}
            className="text-xs font-medium text-[var(--content-accent)]"
          >
            + Add note (optional)
          </button>
        ) : (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Additional notes (optional)"
            className="w-full h-20 px-4 py-3 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-primary)] border border-[var(--border-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--border-negative)]"
          />
        )}

        <BigButton
          variant="primary"
          onClick={handleSubmit}
          disabled={
            !reason || (reason === 'Price Mismatch' && !boxPrice.trim())
          }
          loading={loading}
          className="bg-[var(--bg-negative)] text-[var(--content-on-color)]"
        >
          <Flag size={18} weight="fill" />
          Flag and notify billing
        </BigButton>
      </div>
    </BottomSheet>
  );
}
