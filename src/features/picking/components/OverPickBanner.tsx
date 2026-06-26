import { CheckCircle, NotePencil, Warning } from '@phosphor-icons/react';
import { normalizeUom, uomLabel } from '../../../lib/picking/pickerMicrocopy';

export interface OverPickBannerProps {
  extraQty: number;
  remainingQty: number;
  uom: string;
  note: string;
  onOpenNote: () => void;
}

export function OverPickBanner({
  extraQty,
  remainingQty,
  uom,
  note,
  onOpenNote,
}: OverPickBannerProps): React.JSX.Element {
  const uomNorm = normalizeUom(uom);
  const hasNote = note.trim().length > 0;
  const notePreview =
    note.trim().length > 36 ? `${note.trim().slice(0, 36)}…` : note.trim();

  return (
    <button
      type="button"
      onClick={onOpenNote}
      className={`animate-pick-note-panel-enter flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left pick-pressable ${
        hasNote
          ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)]'
          : 'border-[var(--border-negative)] bg-[var(--bg-negative-subtle)]'
      }`}
    >
      {hasNote ? (
        <CheckCircle
          size={18}
          weight="fill"
          className="mt-0.5 shrink-0 text-[var(--content-positive)]"
          aria-hidden
        />
      ) : (
        <Warning
          size={18}
          weight="fill"
          className="mt-0.5 shrink-0 text-[var(--content-negative)]"
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        {hasNote ? (
          <>
            <p className="font-ds-caption-size font-semibold text-[var(--content-positive)]">
              {notePreview}
            </p>
            <p className="mt-0.5 font-ds-micro text-[var(--content-secondary)]">Tap to change reason</p>
          </>
        ) : (
          <>
            <p className="font-ds-caption-size font-semibold text-[var(--content-negative)]">
              {extraQty} {uomLabel(uomNorm, extraQty)} over — billing needs a reason
            </p>
            <p className="mt-0.5 font-ds-micro text-[var(--content-negative)]/85">
              Only {remainingQty} {uomLabel(uomNorm, remainingQty)} left on this line
            </p>
          </>
        )}
      </div>
      <NotePencil
        size={18}
        className={`mt-0.5 shrink-0 ${hasNote ? 'text-[var(--content-positive)]' : 'text-[var(--content-negative)]'}`}
        aria-hidden
      />
    </button>
  );
}
