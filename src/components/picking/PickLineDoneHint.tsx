import { PickLineAdvanceCTA } from './PickLineAdvanceCTA';
import type { NextPickLinePreview } from '../../lib/picking/deckOrder';

/** Shown when revisiting an already-done line — same confirm-and-next affordance as fresh picks. */
export function PickLineDoneHint({
  kind,
  pickedQty,
  targetQty,
  nextPreview,
  onNext,
}: {
  kind: 'picked' | 'flagged';
  pickedQty?: number;
  targetQty?: number;
  nextPreview: NextPickLinePreview | null;
  onNext?: () => void;
}): React.JSX.Element | null {
  if (!onNext) return null;

  const isPicked = kind === 'picked';
  const complete =
    isPicked &&
    targetQty != null &&
    targetQty > 0 &&
    pickedQty != null &&
    pickedQty >= targetQty;

  const title = isPicked
    ? complete
      ? `${pickedQty ?? targetQty} pcs picked ✓`
      : 'Line complete'
    : 'Sent to billing for review';

  const detail = isPicked
    ? complete
      ? 'Tap below to go to the next rack'
      : pickedQty != null && targetQty != null
        ? `${pickedQty}/${targetQty} pcs on this line`
        : 'Tap below to continue picking'
    : 'Billing will review this line';

  return (
    <PickLineAdvanceCTA
      tone={isPicked ? 'success' : 'warning'}
      title={title}
      detail={detail}
      nextPreview={nextPreview}
      onConfirmNext={onNext}
    />
  );
}
