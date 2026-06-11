import type { StockMrpHistoryEntry } from '../../types';
import { Numpad, NumpadConfirmButton, numKey } from './Numpad';
import { UomBadge } from './UomBadge';
import { mrpEntryCtaLabel, normalizeUom, uomOrderedLabel } from '../../lib/picking/pickerMicrocopy';

export interface MrpEntryScreenProps {
  rackNo: string | null;
  partCode: string;
  itemName: string;
  targetQty: number;
  uom: string;
  numBuf: string;
  mrpHistory: StockMrpHistoryEntry[];
  mrpLoading?: boolean;
  positionLabel?: string;
  onNumKey: (key: string) => void;
  onConfirm: () => void;
  onSelectSuggestion: (mrp: number) => void;
  onBack?: () => void;
}

function parseMrp(buf: string): number | null {
  const n = parseInt(buf, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function MrpEntryScreen({
  rackNo,
  partCode,
  itemName,
  targetQty,
  uom,
  numBuf,
  mrpHistory,
  mrpLoading = false,
  positionLabel,
  onNumKey,
  onConfirm,
  onSelectSuggestion,
  onBack,
}: MrpEntryScreenProps): React.JSX.Element {
  const uomNorm = normalizeUom(uom);
  const mrp = parseMrp(numBuf);
  const ctaLabel = mrpEntryCtaLabel(mrp);
  const canConfirm = mrp != null;

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
              ← Back
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
        className="shrink-0 border-b px-3 py-3 sm:px-4"
        style={{
          backgroundColor: 'var(--bg-positive-subtle)',
          borderColor: 'var(--border-positive)',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-positive)]">
              ⊙ {rackNo ?? '—'}
            </p>
            <p className="pick-hero-code mt-0.5 font-mono font-bold text-[var(--content-primary)]">
              {partCode}
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--content-secondary)]">{itemName}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-2xl font-extrabold tabular-nums text-[var(--content-primary)]">
              {targetQty}
            </p>
            <p className="mt-0.5 text-[9px] font-medium text-[var(--content-positive)]">
              {uomOrderedLabel(uomNorm)}
            </p>
            <UomBadge uom={uomNorm} className="mt-1" />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 text-center">
        <p className="text-sm font-semibold text-[var(--content-primary)]">MRP on the label?</p>
        <p className="mt-1 text-xs text-[var(--content-tertiary)]">Read the price sticker and enter below</p>

        <div className="mt-6 flex items-baseline justify-center gap-1">
          <span className="text-2xl font-medium text-[var(--content-tertiary)]">₹</span>
          <span className="pick-sheet-display font-mono font-extrabold tabular-nums text-[var(--content-accent)]">
            {numBuf || '—'}
          </span>
        </div>

        {mrpLoading ? (
          <p className="mt-4 text-xs text-[var(--content-tertiary)]">Loading suggestions…</p>
        ) : mrpHistory.length > 0 ? (
          <div className="mt-5">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              From stock
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {mrpHistory.slice(0, 4).map((h) => (
                <button
                  key={`${h.mrp}-${h.date}`}
                  type="button"
                  onClick={() => onSelectSuggestion(h.mrp)}
                  className={`rounded-full border px-3 py-1.5 font-mono text-sm font-bold tabular-nums pick-pressable ${
                    mrp === Math.round(h.mrp)
                      ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-primary)]'
                  }`}
                >
                  ₹{Math.round(h.mrp)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="px-3 pt-2 sm:px-4">
          <Numpad display={numBuf} onKey={onNumKey} onConfirm={onConfirm} confirmLabel={ctaLabel} hideConfirm />
        </div>
        <div className="border-t border-[var(--border-subtle)] p-3 sm:p-4">
          <NumpadConfirmButton
            onConfirm={onConfirm}
            confirmLabel={ctaLabel}
            disabled={!canConfirm}
          />
        </div>
      </div>
    </div>
  );
}

export { numKey };
