import { CheckCircle } from '@phosphor-icons/react';
import { normalizeUom } from '../../../lib/picking/pickerMicrocopy';

export interface GapStateProps {
  remainingQty: number;
  totalLogged: number;
  uom: string;
  onNextLabel: () => void;
  onShortStock: () => void;
}

export function GapState({
  remainingQty,
  totalLogged,
  uom,
  onNextLabel,
  onShortStock,
}: GapStateProps): React.JSX.Element | null {
  if (remainingQty <= 0) return null;

  const uomNorm = normalizeUom(uom);

  return (
    <div className="flex flex-col items-center px-4 py-6 text-center">
      <p className="font-ds-label-size font-semibold uppercase tracking-wider text-[var(--content-warning-on-light)]">
        Still to pick
      </p>
      <p className="pick-sheet-display mt-3 font-mono font-extrabold tabular-nums text-[var(--content-warning-on-light)]">
        {remainingQty}
      </p>
      <p className="mt-2 font-ds-body-size font-medium text-[var(--content-warning-on-light)]">
        {remainingQty} {uomNorm} still unlogged
      </p>
      <p className="mt-1 font-ds-micro text-[var(--content-tertiary)]">{totalLogged} logged so far</p>

      <div className="mt-8 grid w-full grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onShortStock}
          className="min-h-11 rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] font-ds-body-size font-bold text-[var(--content-warning-on-light)] pick-pressable"
        >
          Short pick
        </button>
        <button
          type="button"
          onClick={onNextLabel}
          className="min-h-11 rounded-xl bg-[var(--bg-inverse-primary)] font-ds-body-size font-extrabold text-white pick-pressable"
        >
          <span className="inline-flex items-center justify-center gap-1">
            <span>Pick remaining</span>
            <span aria-hidden="true">→</span>
          </span>
        </button>
      </div>
    </div>
  );
}

export interface PickCompleteStateProps {
  targetQty: number;
  uom: string;
  onMarkPicked: () => void;
}

export function PickCompleteState({
  targetQty,
  uom,
  onMarkPicked,
}: PickCompleteStateProps): React.JSX.Element {
  const uomNorm = normalizeUom(uom);

  return (
    <div className="px-4 py-5">
      <div className="rounded-2xl border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-4 py-6 text-center">
        <CheckCircle
          size={36}
          weight="fill"
          className="mx-auto text-[var(--content-positive)]"
          aria-hidden
        />
        <p className="mt-3 font-ds-body-size font-extrabold text-[var(--content-positive)]">
          All {targetQty} {uomNorm.toLowerCase()} logged ✓
        </p>
        <p className="mt-1 font-ds-caption-size text-[var(--content-secondary)]">
          Count matches the order — mark this line picked.
        </p>
        <div className="mt-5">
          <button
            type="button"
            onClick={onMarkPicked}
            className="w-full min-h-12 rounded-2xl bg-[var(--bg-positive)] font-ds-body-size font-extrabold text-white pick-pressable"
          >
            Mark picked →
          </button>
        </div>
      </div>
    </div>
  );
}
