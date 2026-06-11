import { UomBadge } from './UomBadge';
import { gapHeroSubLabel, normalizeUom } from '../../lib/picking/pickerMicrocopy';
import type { PickerV10LoggedBatch } from './types';

export interface GapStateScreenProps {
  rackNo: string | null;
  partCode: string;
  itemName: string;
  targetQty: number;
  remainingQty: number;
  uom: string;
  loggedBatches: PickerV10LoggedBatch[];
  onNextLabel: () => void;
  onFlagShort: () => void;
}

export function GapStateScreen({
  rackNo,
  partCode,
  itemName,
  targetQty,
  remainingQty,
  uom,
  loggedBatches,
  onNextLabel,
  onFlagShort,
}: GapStateScreenProps): React.JSX.Element {
  const uomNorm = normalizeUom(uom);
  const subLabel = gapHeroSubLabel(remainingQty, targetQty, uomNorm);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <div
        className="shrink-0 border-b px-3 py-3 sm:px-4"
        style={{
          backgroundColor: 'var(--bg-positive-subtle)',
          borderColor: 'var(--border-positive)',
        }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-positive)]">
          ⊙ {rackNo ?? '—'}
        </p>
        <p className="pick-hero-code mt-0.5 font-mono font-bold text-[var(--content-primary)]">{partCode}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-[var(--content-secondary)]">{itemName}</p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-warning-on-light)]">
          Still to pick
        </p>
        <p
          className="pick-sheet-display mt-4 font-mono font-extrabold tabular-nums text-[var(--content-warning-on-light)]"
        >
          {remainingQty}
        </p>
        <p className="mt-2 text-sm font-medium text-[var(--content-warning-on-light)]">{subLabel}</p>
        <UomBadge uom={uomNorm} className="mt-3" />

        {loggedBatches.length > 0 ? (
          <div className="mt-8 w-full max-w-sm">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Logged batches
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {loggedBatches.map((b, i) => (
                <span
                  key={`${b.mrp}-${b.qty}-${i}`}
                  className="inline-flex rounded-full border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-2.5 py-1 text-[10px] font-semibold text-[var(--content-positive)]"
                >
                  ₹{Math.round(b.mrp)} ×{b.qty}
                  {b.picker_note ? ' · noted' : ''}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 space-y-2 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
        <button
          type="button"
          onClick={onNextLabel}
          className="w-full min-h-[52px] rounded-2xl bg-[var(--bg-inverse-primary)] text-base font-extrabold text-white pick-pressable"
        >
          Next label →
        </button>
        <button
          type="button"
          onClick={onFlagShort}
          className="w-full min-h-[44px] rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-sm font-bold text-[var(--content-warning-on-light)] pick-pressable"
        >
          Flag short stock
        </button>
      </div>
    </div>
  );
}
