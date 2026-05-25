import type { PickerV10DoneEntry } from './types';

export interface DoneListProps {
  entries: PickerV10DoneEntry[];
}

export function DoneList({ entries }: DoneListProps): React.JSX.Element | null {
  if (entries.length === 0) return null;

  return (
    <div className="mx-4 mt-3.5">
      <p className="mb-2 pl-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
        Picked
      </p>
      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        {entries.map((d, i) => (
          <div
            key={`${d.code}-${i}`}
            className={`flex items-center gap-3 px-4 py-3 ${
              i < entries.length - 1 ? 'border-b border-[var(--border-faint)]' : ''
            }`}
          >
            <span
              className={`shrink-0 text-sm ${
                d.outOfStock
                  ? 'text-[var(--content-negative)]'
                  : d.mrpFlagged
                    ? 'text-[var(--content-warning-on-light)]'
                    : 'text-[var(--content-positive)]'
              }`}
            >
              {d.outOfStock ? '✗' : '✓'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm font-extrabold tracking-tight text-[var(--content-primary)]">
                {d.code}
              </p>
              {d.mrpFlagged && (
                <p className="mt-0.5 text-[10px] font-semibold text-[var(--content-warning-on-light)]">
                  Label ₹{Math.round(d.confirmedMrp ?? 0)} · system ₹{Math.round(d.latestMrp ?? 0)} · flagged
                </p>
              )}
              {!d.mrpFlagged && d.confirmedMrp != null && (
                <p className="mt-0.5 text-[10px] text-[var(--content-tertiary)]">
                  MRP ₹{Math.round(d.confirmedMrp)} confirmed
                  {d.historyCount > 1 ? ` · ${d.historyCount} records in system` : ''}
                </p>
              )}
              {d.outOfStock && (
                <p className="mt-0.5 text-[10px] font-semibold text-[var(--content-negative)]">Out of stock</p>
              )}
            </div>
            <p
              className={`shrink-0 font-mono text-sm font-bold ${
                d.outOfStock ? 'text-[var(--content-tertiary)]' : 'text-[var(--content-secondary)]'
              }`}
            >
              {d.outOfStock ? '—' : `${d.qty} pcs`}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
