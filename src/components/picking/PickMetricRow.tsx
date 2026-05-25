import type { StockMrpHistoryEntry } from '../../types';

export interface PickMetricRowProps {
  /** Pieces left to pick on this line. */
  displayQty: number;
  targetQty: number;
  pickedQty: number;
  mrpHistory: StockMrpHistoryEntry[];
  mrpLoading?: boolean;
  confirmedMrp: number | null;
  customMrp: number | null;
  disabled?: boolean;
  onEditQty: () => void;
  onEditMrp: () => void;
}

/**
 * Tap-to-edit qty + MRP cells. Sits below the rack/code hero — does not compete with that hierarchy.
 */
export function PickMetricRow({
  displayQty,
  targetQty,
  pickedQty,
  mrpHistory,
  mrpLoading = false,
  confirmedMrp,
  customMrp,
  disabled = false,
  onEditQty,
  onEditMrp,
}: PickMetricRowProps): React.JSX.Element {
  const latestMrp = mrpHistory[0]?.mrp ?? null;
  const finalMrp = customMrp ?? confirmedMrp;
  const mrpFlagged = finalMrp != null && latestMrp != null && finalMrp !== latestMrp;
  const isMultiMrp = mrpHistory.length > 1;
  const isPartialQty = pickedQty > 0 && pickedQty < targetQty;

  return (
    <div className="mx-4 mb-2 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
      <div className="flex">
        <button
          type="button"
          disabled={disabled}
          onClick={onEditQty}
          className={`relative flex-1 border-r border-[var(--border-faint)] px-4 py-3 text-left pick-pressable disabled:opacity-50 ${
            isPartialQty ? 'bg-[var(--bg-warning-subtle)]' : ''
          }`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            Pick qty
          </p>
          <div className="mt-1 flex items-baseline gap-1">
            <span
              className={`font-mono text-2xl font-extrabold leading-none tracking-tight ${
                isPartialQty
                  ? 'text-[var(--content-warning-on-light)]'
                  : 'text-[var(--content-primary)]'
              }`}
            >
              {displayQty}
            </span>
            <span className="text-xs text-[var(--content-tertiary)]">pcs</span>
          </div>
          <p
            className={`mt-0.5 text-[9px] font-medium ${
              isPartialQty ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-tertiary)]'
            }`}
          >
            {pickedQty > 0 ? `${pickedQty} picked · ` : ''}
            {targetQty} target
            {isPartialQty ? ` · ${targetQty - pickedQty} short` : ''}
          </p>
          <span className="absolute right-2.5 top-2.5 text-[10px] text-[var(--border-opaque)]">✎</span>
        </button>

        <button
          type="button"
          disabled={disabled || mrpLoading}
          onClick={onEditMrp}
          className="relative flex-1 px-4 py-3 text-left pick-pressable disabled:opacity-50"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            MRP on label
          </p>

          {mrpLoading ? (
            <p className="mt-2 text-xs text-[var(--content-tertiary)]">Loading…</p>
          ) : finalMrp != null ? (
            <>
              <p
                className={`mt-1 font-mono text-2xl font-extrabold leading-none tracking-tight ${
                  mrpFlagged ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-positive)]'
                }`}
              >
                ₹{Math.round(finalMrp)}
              </p>
              <p
                className={`text-[9px] font-semibold ${
                  mrpFlagged ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-positive)]'
                }`}
              >
                {mrpFlagged ? `differs · system ₹${Math.round(latestMrp ?? 0)}` : 'confirmed ✓'}
              </p>
            </>
          ) : isMultiMrp ? (
            <>
              <p className="mt-1.5 text-xs font-bold text-[var(--content-warning-on-light)]">
                Multiple found
              </p>
              <p className="text-[10px] leading-snug text-[var(--content-tertiary)]">
                {mrpHistory.map((h) => `₹${Math.round(h.mrp)}`).join(' · ')}
              </p>
            </>
          ) : latestMrp != null ? (
            <>
              <p className="mt-1 font-mono text-2xl font-extrabold leading-none tracking-tight text-[var(--content-warning-on-light)]">
                ₹{Math.round(latestMrp)}
              </p>
              <p className="text-[9px] font-medium text-[var(--content-warning-on-light)]">tap to confirm</p>
            </>
          ) : (
            <p className="mt-2 text-xs text-[var(--content-tertiary)]">Tap to enter</p>
          )}

          <span
            className={`absolute right-2.5 top-2.5 text-[10px] ${
              finalMrp != null
                ? mrpFlagged
                  ? 'text-[var(--border-warning)]'
                  : 'text-[var(--border-positive)]'
                : latestMrp != null
                  ? 'text-[var(--border-warning)]'
                  : 'text-[var(--border-opaque)]'
            }`}
          >
            {finalMrp != null ? (mrpFlagged ? '⚠' : '✓') : '✎'}
          </span>
        </button>
      </div>

      {finalMrp != null && (
        <div
          className={`mx-3 mb-3 flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
            mrpFlagged
              ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]'
              : 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)]'
          }`}
        >
          <span className="text-xs">{mrpFlagged ? '⚠' : '✓'}</span>
          <p
            className={`flex-1 text-[11px] font-semibold leading-snug ${
              mrpFlagged ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-positive)]'
            }`}
          >
            {mrpFlagged
              ? `Label ₹${Math.round(finalMrp)} ≠ system ₹${Math.round(latestMrp ?? 0)}`
              : `MRP ₹${Math.round(finalMrp)} confirmed on label`}
          </p>
          <button type="button" onClick={onEditMrp} className="shrink-0 text-[10px] font-semibold opacity-80 pick-pressable">
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
