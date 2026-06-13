import { useState } from 'react';
import { BottomSheet, BigButton } from '../shared';
import type { VisitOutcome } from '../../types/visit';

const OUTCOMES: { id: VisitOutcome; label: string }[] = [
  { id: 'order_placed', label: 'Order placed' },
  { id: 'payment_collected', label: 'Payment collected' },
  { id: 'follow_up', label: 'Follow-up needed' },
  { id: 'no_purchase', label: 'No purchase' },
];

export function EndVisitSheet({
  isOpen,
  onClose,
  startedAt,
  defaultOutcome,
  onComplete,
  isSubmitting,
}: {
  isOpen: boolean;
  onClose: () => void;
  startedAt: string;
  defaultOutcome?: VisitOutcome | null;
  onComplete: (payload: { outcome: VisitOutcome; notes: string }) => Promise<void>;
  isSubmitting?: boolean;
}): React.JSX.Element | null {
  const [outcome, setOutcome] = useState<VisitOutcome>(defaultOutcome ?? 'follow_up');
  const [notes, setNotes] = useState('');

  const durationMinutes = Math.max(
    1,
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000),
  );

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="End visit"
      footer={
        <BigButton
          variant="primary"
          disabled={isSubmitting}
          onClick={async () => {
            await onComplete({ outcome, notes });
          }}
        >
          Complete visit
        </BigButton>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-[var(--content-secondary)] mb-2">What was the outcome?</p>
          <div className="grid grid-cols-2 gap-2">
            {OUTCOMES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setOutcome(item.id)}
                className={`rounded-xl border px-3 py-3 text-sm font-semibold transition-colors ${
                  outcome === item.id
                    ? 'border-[var(--role-primary)] bg-[var(--role-primary-subtle)] text-[var(--role-content)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-[var(--content-primary)]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-[var(--content-secondary)]">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Kya baat hui, kya promising tha…"
            rows={3}
            className="mt-2 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--role-primary)]"
          />
        </div>

        <p className="text-xs text-[var(--content-tertiary)]">
          Duration: {durationMinutes} min · GPS logged
        </p>
      </div>
    </BottomSheet>
  );
}
