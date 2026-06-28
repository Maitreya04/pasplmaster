import { ArrowCounterClockwise, ArrowRight, CheckCircle, Flag, Warning } from '@phosphor-icons/react';
import type { NextPickLinePreview } from '../../lib/picking/deckOrder';

export type PickLineAdvanceTone = 'success' | 'warning' | 'neutral';

export interface PickLineAdvanceCTAProps {
  tone: PickLineAdvanceTone;
  /** Short closure line, e.g. "40 pcs picked ✓" */
  title: string;
  detail?: string;
  /** Next unpicked line — drives button copy and preview */
  nextPreview: NextPickLinePreview | null;
  onConfirmNext: () => void;
  onUndoPick?: () => void;
  undoLabel?: string;
  undoDisabled?: boolean;
}

function toneStyles(tone: PickLineAdvanceTone): {
  border: string;
  bg: string;
  title: string;
  button: string;
} {
  switch (tone) {
    case 'success':
      return {
        border: 'border-[var(--border-positive)]',
        bg: 'bg-[var(--bg-positive-subtle)]',
        title: 'text-[var(--content-positive)]',
        button: 'bg-[var(--bg-positive)]',
      };
    case 'warning':
      return {
        border: 'border-[var(--border-warning)]',
        bg: 'bg-[var(--bg-warning-subtle)]',
        title: 'text-[var(--content-warning-on-light)]',
        button: 'bg-[var(--bg-inverse-primary)]',
      };
    default:
      return {
        border: 'border-[var(--border-subtle)]',
        bg: 'bg-[var(--bg-secondary)]',
        title: 'text-[var(--content-secondary)]',
        button: 'bg-[var(--bg-inverse-primary)]',
      };
  }
}

function StatusIcon({ tone }: { tone: PickLineAdvanceTone }): React.JSX.Element {
  if (tone === 'success') {
    return (
      <CheckCircle
        size={28}
        weight="fill"
        className="shrink-0 text-[var(--content-positive)]"
      />
    );
  }
  if (tone === 'warning') {
    return (
      <Warning
        size={28}
        weight="fill"
        className="shrink-0 text-[var(--content-warning-on-light)]"
      />
    );
  }
  return (
    <Flag
      size={26}
      weight="fill"
      className="shrink-0 text-[var(--content-warning-on-light)]"
    />
  );
}

/**
 * Closure step after a line is picked or flagged — explicit confirm before advancing.
 * Maps to picker mental model: acknowledge this line → move to the next rack.
 */
export function PickLineAdvanceCTA({
  tone,
  title,
  detail,
  nextPreview,
  onConfirmNext,
  onUndoPick,
  undoLabel = 'Undo pick · change MRP or qty',
  undoDisabled = false,
}: PickLineAdvanceCTAProps): React.JSX.Element {
  const styles = toneStyles(tone);
  const confirmLabel = nextPreview ? 'Next line' : 'Finish pick';
  const previewLine = nextPreview
    ? `${nextPreview.code} · Rack ${nextPreview.rackNo ?? '—'}`
    : 'All lines handled — pack & finish next';

  return (
    <div className={`shrink-0 border-t px-3 py-3 sm:px-4 sm:py-4 ${styles.border} ${styles.bg}`}>
      <div className="mb-3 flex items-start gap-2.5 sm:gap-3">
        <StatusIcon tone={tone} />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-extrabold leading-snug break-words sm:text-base ${styles.title}`}>
            {title}
          </p>
          {detail ? (
            <p className="mt-1 text-xs font-medium text-[var(--content-secondary)]">{detail}</p>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onConfirmNext}
        className={`flex w-full min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-2xl px-4 py-3 text-white pick-pressable shadow-sm sm:min-h-[56px] ${styles.button}`}
        aria-label={nextPreview ? `${confirmLabel}. ${previewLine}` : confirmLabel}
      >
        <span className="inline-flex items-center gap-2 text-base font-extrabold sm:text-lg">
          {confirmLabel}
          <ArrowRight size={22} weight="bold" />
        </span>
        <span className="max-w-full truncate text-[11px] font-semibold text-white/85">
          {previewLine}
        </span>
      </button>

      {onUndoPick ? (
        <button
          type="button"
          onClick={onUndoPick}
          disabled={undoDisabled}
          className="mt-2 flex w-full min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2.5 text-xs font-semibold text-[var(--content-secondary)] pick-pressable disabled:opacity-50"
        >
          <ArrowCounterClockwise size={16} weight="bold" />
          {undoLabel}
        </button>
      ) : null}

      <p className="mt-2 text-center text-[10px] font-medium text-[var(--content-tertiary)]">
        Swipe › browse lines · Pull ↑ for queue
      </p>
    </div>
  );
}
