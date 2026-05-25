import { ArrowRight } from '@phosphor-icons/react';

/** Shown when revisiting an already-done line (no active outcome dwell). */
export function PickLineDoneHint({
  kind,
  onNext,
}: {
  kind: 'picked' | 'flagged';
  onNext?: () => void;
}): React.JSX.Element {
  const isPicked = kind === 'picked';

  return (
    <div className="shrink-0 border-t border-[var(--border-faint)] px-4 py-3 text-center">
      <p className="text-sm font-semibold text-[var(--content-tertiary)]">
        {isPicked ? 'Line complete' : 'Sent to billing for review'}
      </p>
      {onNext ? (
        <button
          type="button"
          onClick={onNext}
          className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-[var(--content-accent)] pick-pressable"
        >
          Next item
          <ArrowRight size={16} weight="bold" />
        </button>
      ) : null}
    </div>
  );
}
