import { ArrowRight, CheckCircle, Flag, Warning } from '@phosphor-icons/react';

export type PickLineOutcomeKind = 'picked' | 'partial' | 'flagged';

export interface PickLineResolvedDockProps {
  kind: PickLineOutcomeKind;
  /** e.g. "600 pcs picked" or "Wrong MRP" */
  headline: string;
  detail?: string;
  onNext: () => void;
}

/**
 * Closure beat after a line is picked or flagged — explicit Next CTA, not passive text.
 */
export function PickLineResolvedDock({
  kind,
  headline,
  detail,
  onNext,
}: PickLineResolvedDockProps): React.JSX.Element {
  const isFullPick = kind === 'picked';
  const isPartial = kind === 'partial';

  return (
    <div
      className={`border-t px-4 py-4 ${
        isFullPick
          ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)]'
          : 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]'
      }`}
    >
      <div className="mb-3 flex items-start gap-3">
        {isFullPick ? (
          <CheckCircle
            size={28}
            weight="fill"
            className="shrink-0 text-[var(--content-positive)]"
          />
        ) : isPartial ? (
          <Warning
            size={28}
            weight="fill"
            className="shrink-0 text-[var(--content-warning-on-light)]"
          />
        ) : (
          <Flag
            size={26}
            weight="fill"
            className="shrink-0 text-[var(--content-warning-on-light)]"
          />
        )}
        <div className="min-w-0 flex-1">
          <p
            className={`text-base font-extrabold leading-tight ${
              isFullPick ? 'text-[var(--content-positive)]' : 'text-[var(--content-warning-on-light)]'
            }`}
          >
            {headline}
          </p>
          {detail ? (
            <p className="mt-1 text-xs font-medium text-[var(--content-secondary)]">{detail}</p>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onNext}
        className={`flex w-full min-h-[52px] items-center justify-center gap-2 rounded-2xl text-base font-extrabold text-white pick-pressable ${
          isFullPick ? 'bg-[var(--bg-positive)]' : 'bg-[var(--bg-inverse-primary)]'
        }`}
      >
        Next item
        <ArrowRight size={20} weight="bold" />
      </button>

      <p className="mt-2 text-center text-[10px] font-medium text-[var(--content-tertiary)]">
        Swipe › for next · ↑ queue to jump
      </p>
    </div>
  );
}
