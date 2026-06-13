import { useState } from 'react';
import { BottomSheet, BigButton } from '../shared';
import { formatDistanceM } from '../../lib/geo/distanceUtils';
import type { GeofenceEvaluation, VisitOverrideReason } from '../../types/visit';

const OVERRIDE_OPTIONS: { id: VisitOverrideReason; label: string }[] = [
  { id: 'customer_moved', label: 'Customer moved location' },
  { id: 'gps_not_working', label: 'GPS not working properly' },
  { id: 'different_branch_godown', label: 'Visiting their other branch/godown' },
  { id: 'customer_met_me_here', label: 'Customer met me here' },
];

export function GeofenceOverrideSheet({
  isOpen,
  customerName,
  evaluation,
  onContinue,
  onCancel,
  isSubmitting,
}: {
  isOpen: boolean;
  customerName: string;
  evaluation: GeofenceEvaluation | null;
  onContinue: (reason: VisitOverrideReason) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}): React.JSX.Element | null {
  const [reason, setReason] = useState<VisitOverrideReason>('gps_not_working');

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onCancel}
      title="Location required"
      footer={
        <BigButton variant="primary" disabled={isSubmitting} onClick={() => onContinue(reason)}>
          Continue visit
        </BigButton>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--content-primary)]">
          You&apos;re {formatDistanceM(evaluation?.distance_m)} from{' '}
          <span className="font-semibold">{customerName}</span>. Select a reason to continue:
        </p>
        <div className="space-y-2">
          {OVERRIDE_OPTIONS.map((option) => (
            <label
              key={option.id}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 ${
                reason === option.id
                  ? 'border-[var(--role-primary)] bg-[var(--role-primary-subtle)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)]'
              }`}
            >
              <input
                type="radio"
                name="override-reason"
                checked={reason === option.id}
                onChange={() => setReason(option.id)}
                className="accent-[var(--role-primary)]"
              />
              <span className="text-sm text-[var(--content-primary)]">{option.label}</span>
            </label>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}
