import { PickLineAdvanceCTA } from './PickLineAdvanceCTA';
import type { NextPickLinePreview } from '../../lib/picking/deckOrder';

export type PickLineOutcomeKind = 'picked' | 'partial' | 'flagged';

export interface PickLineResolvedDockProps {
  kind: PickLineOutcomeKind;
  headline: string;
  detail?: string;
  nextPreview: NextPickLinePreview | null;
  onNext: () => void;
}

/**
 * Closure beat after a line is picked or flagged — confirm before advancing.
 */
export function PickLineResolvedDock({
  kind,
  headline,
  detail,
  nextPreview,
  onNext,
}: PickLineResolvedDockProps): React.JSX.Element {
  const tone =
    kind === 'picked' ? 'success' : kind === 'partial' ? 'warning' : 'warning';

  return (
    <PickLineAdvanceCTA
      tone={tone}
      title={headline}
      detail={detail}
      nextPreview={nextPreview}
      onConfirmNext={onNext}
    />
  );
}
