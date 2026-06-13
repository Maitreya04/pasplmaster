import { BottomSheet, BigButton } from '../shared';
import { formatDistanceM } from '../../lib/geo/distanceUtils';
import type { GeofenceEvaluation } from '../../types/visit';

export function GeofenceWarningSheet({
  isOpen,
  customerName,
  evaluation,
  onProceed,
  onCancel,
  isSubmitting,
}: {
  isOpen: boolean;
  customerName: string;
  evaluation: GeofenceEvaluation | null;
  onProceed: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}): React.JSX.Element | null {
  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onCancel}
      title="Location notice"
      footer={
        <div className="grid grid-cols-2 gap-2">
          <BigButton variant="secondary" onClick={onCancel}>
            Cancel
          </BigButton>
          <BigButton variant="primary" disabled={isSubmitting} onClick={onProceed}>
            Proceed anyway
          </BigButton>
        </div>
      }
    >
      <p className="text-sm text-[var(--content-primary)] leading-relaxed">
        You appear to be about {formatDistanceM(evaluation?.distance_m)} from{' '}
        <span className="font-semibold">{customerName}</span>&apos;s usual location.
      </p>
    </BottomSheet>
  );
}
