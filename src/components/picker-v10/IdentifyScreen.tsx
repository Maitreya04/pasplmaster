import { UomBadge } from './UomBadge';
import { normalizeUom, uomOrderedLabel } from '../../lib/picking/pickerMicrocopy';

export interface IdentifyScreenProps {
  rackNo: string | null;
  partCode: string;
  itemName: string;
  targetQty: number;
  uom: string;
  positionLabel?: string;
  onConfirm: () => void;
  onBack?: () => void;
}

export function IdentifyScreen({
  rackNo,
  partCode,
  itemName,
  targetQty,
  uom,
  positionLabel,
  onConfirm,
  onBack,
}: IdentifyScreenProps): React.JSX.Element {
  const uomNorm = normalizeUom(uom);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <div className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2 sm:px-4">
        <div className="flex items-center justify-between gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="text-sm font-medium text-[var(--content-secondary)] pick-pressable"
            >
              ← Rack list
            </button>
          ) : (
            <span />
          )}
          {positionLabel ? (
            <span className="rounded-full bg-[var(--bg-tertiary)] px-2.5 py-1 text-[10px] font-semibold text-[var(--content-tertiary)]">
              {positionLabel}
            </span>
          ) : null}
        </div>
      </div>

      <div
        className="shrink-0 border-b px-3 py-2 sm:px-4"
        style={{
          backgroundColor: 'var(--bg-positive-subtle)',
          borderColor: 'var(--border-positive)',
        }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-positive)]">
          ⊙ {rackNo ?? '—'}
        </p>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
          Match label to bin
        </p>
        <p
          className="mt-6 font-mono font-extrabold leading-none tracking-tight text-[var(--content-primary)]"
          style={{ fontSize: 'clamp(2rem, 12vw, 2.5rem)' }}
        >
          {partCode}
        </p>
        <p className="mt-3 max-w-xs text-sm leading-snug text-[var(--content-secondary)]">{itemName}</p>

        <div className="mt-8 flex items-center gap-3">
          <div className="text-right">
            <p className="font-mono text-3xl font-extrabold tabular-nums text-[var(--content-primary)]">
              {targetQty}
            </p>
            <p className="text-[10px] font-medium text-[var(--content-tertiary)]">
              {uomOrderedLabel(uomNorm)}
            </p>
          </div>
          <UomBadge uom={uomNorm} />
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
        <button
          type="button"
          onClick={onConfirm}
          className="w-full min-h-[56px] rounded-2xl bg-[var(--bg-inverse-primary)] text-base font-extrabold text-white pick-pressable"
        >
          Got it — log MRP + qty
        </button>
      </div>
    </div>
  );
}
