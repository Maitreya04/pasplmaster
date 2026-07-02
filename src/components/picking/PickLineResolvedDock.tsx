import { PickLineAdvanceCTA } from './PickLineAdvanceCTA';
import type { NextPickLinePreview } from '../../lib/picking/deckOrder';

export type PickLineOutcomeKind = 'picked' | 'partial' | 'flagged';

export interface PickLineResolvedDockProps {
  kind: PickLineOutcomeKind;
  headline: string;
  detail?: string;
  nextPreview: NextPickLinePreview | null;
  onNext: () => void;
  onUndoPick?: () => void;
  undoDisabled?: boolean;
}

/**
 * Closure beat after a line is flagged — confirm before advancing (exceptions only).
 */
export function PickLineResolvedDock({
  kind,
  headline,
  detail,
  nextPreview,
  onNext,
  onUndoPick,
  undoDisabled = false,
}: PickLineResolvedDockProps): React.JSX.Element {
  const tone =
    kind === 'picked' ? 'success' : kind === 'partial' ? 'warning' : 'warning';
  const undoLabel = kind === 'flagged' ? 'Undo flag' : 'Undo pick · change MRP or qty';

  return (
    <PickLineAdvanceCTA
      tone={tone}
      title={headline}
      detail={detail}
      nextPreview={nextPreview}
      onConfirmNext={onNext}
      onUndoPick={onUndoPick}
      undoLabel={undoLabel}
      undoDisabled={undoDisabled}
    />
  );
}
