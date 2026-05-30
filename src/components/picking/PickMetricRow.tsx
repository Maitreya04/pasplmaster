import type { StockMrpHistoryEntry } from '../../types';
import type { PickLineMrpState } from '../../lib/picking/pickLineMrp';
import {
  MRP_METRIC_LABEL,
  PICKER_MRP_CONFIRMED,
  PICKER_MRP_SPLIT_METRIC_HINT,
  PICKER_MRP_TAP_TO_CONFIRM,
  PICKER_MRP_VS_SUGGESTED,
} from '../../lib/billing/mrpWorkflowCopy';
import {
  getActiveSegmentMrp,
  isSplitMode,
  pickLineSegmentsCommittedQty,
} from '../../lib/picking/pickLineMrp';

export interface PickMetricRowProps {
  /** Pieces left to pick on this line. */
  displayQty: number;
  targetQty: number;
  pickedQty: number;
  mrpHistory: StockMrpHistoryEntry[];
  mrpLoading?: boolean;
  confirmedMrp: number | null;
  customMrp: number | null;
  lineMrp?: PickLineMrpState;
  /** When true, line should be split by MRP batch (multi-MRP + qty > 1). */
  suggestSplit?: boolean;
  splitMrpBands?: number;
  disabled?: boolean;
  onEditQty: () => void;
  onEditMrp: () => void;
  /** Reset qty progress on this line (wrong pick / wrong qty). */
  onUndoPick?: () => void;
  /** Qty-only reset when MRP is not yet confirmed. */
  onUndoQty?: () => void;
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
  lineMrp,
  suggestSplit = false,
  splitMrpBands = 0,
  disabled = false,
  onEditQty,
  onEditMrp,
  onUndoPick,
  onUndoQty,
}: PickMetricRowProps): React.JSX.Element {
  const splitActive = isSplitMode(lineMrp);
  const activeMrp = splitActive ? getActiveSegmentMrp(lineMrp) : null;
  const latestMrp = mrpHistory[0]?.mrp ?? null;
  const finalMrp = splitActive ? activeMrp : (customMrp ?? confirmedMrp);
  const mrpFlagged = finalMrp != null && latestMrp != null && finalMrp !== latestMrp;
  const isMultiMrp = mrpHistory.length > 1;
  const isPartialQty = pickedQty > 0 && pickedQty < targetQty;
  const splitCommitted = splitActive ? pickLineSegmentsCommittedQty(lineMrp) : 0;
  const splitGoal = lineMrp?.originalTargetQty ?? targetQty;

  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] sm:mx-4">
      <div className="flex min-w-0">
        <button
          type="button"
          disabled={disabled}
          onClick={onEditQty}
          className={`relative min-w-0 flex-1 border-r border-[var(--border-faint)] px-2.5 py-2.5 text-left pick-pressable disabled:opacity-50 sm:px-4 sm:py-3 ${
            isPartialQty ? 'bg-[var(--bg-warning-subtle)]' : ''
          }`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            {splitActive ? 'Left on line' : 'Pick qty'}
          </p>
          <div className="mt-1 flex min-w-0 items-baseline gap-1">
            <span
              className={`pick-metric-value font-mono font-extrabold tracking-tight ${
                isPartialQty
                  ? 'text-[var(--content-warning-on-light)]'
                  : 'text-[var(--content-primary)]'
              }`}
            >
              {displayQty}
            </span>
            <span className="shrink-0 text-xs text-[var(--content-tertiary)]">pcs</span>
          </div>
          <p
            className={`mt-0.5 line-clamp-2 text-[9px] font-medium leading-snug ${
              isPartialQty ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-tertiary)]'
            }`}
          >
            {splitActive
              ? `${splitCommitted} picked · ${splitGoal} target`
              : pickedQty > 0
                ? `${pickedQty} picked · `
                : ''}
            {!splitActive && `${targetQty} target`}
            {isPartialQty && !splitActive ? ` · ${targetQty - pickedQty} short` : ''}
          </p>
          <span className="absolute right-2.5 top-2.5 text-[10px] text-[var(--border-opaque)]">✎</span>
        </button>

        <button
          type="button"
          disabled={disabled || mrpLoading}
          onClick={onEditMrp}
          className="relative min-w-0 flex-1 px-2.5 py-2.5 text-left pick-pressable disabled:opacity-50 sm:px-4 sm:py-3"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            {splitActive ? 'Batch MRP' : MRP_METRIC_LABEL}
          </p>

          {mrpLoading ? (
            <p className="mt-2 text-xs text-[var(--content-tertiary)]">Loading…</p>
          ) : finalMrp != null ? (
            <>
              <p
                className={`pick-metric-value mt-1 font-mono font-extrabold tracking-tight ${
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
                {splitActive
                  ? 'active batch'
                  : mrpFlagged
                    ? PICKER_MRP_VS_SUGGESTED(Math.round(finalMrp), Math.round(latestMrp ?? 0))
                    : 'matches suggestion ✓'}
              </p>
            </>
          ) : splitActive ? (
            <>
              <p className="mt-1.5 text-xs font-bold text-[var(--content-warning-on-light)]">
                Tap to pick batch
              </p>
              <p className="text-[10px] leading-snug text-[var(--content-tertiary)]">
                Choose MRP for this batch
              </p>
            </>
          ) : suggestSplit ? (
            <>
              <p className="mt-1.5 text-xs font-bold text-[var(--content-warning-on-light)]">
                {splitMrpBands > 1 ? `${splitMrpBands} MRP batches` : 'Multiple MRP batches'}
              </p>
              <p className="text-[10px] leading-snug text-[var(--content-warning-on-light)]">
                {PICKER_MRP_SPLIT_METRIC_HINT}
              </p>
            </>
          ) : isMultiMrp ? (
            <>
              <p className="mt-1.5 text-xs font-bold text-[var(--content-warning-on-light)]">
                Multiple found
              </p>
              <p className="text-[10px] leading-snug text-[var(--content-tertiary)] line-clamp-2 break-words">
                {mrpHistory.map((h) => `₹${Math.round(h.mrp)}`).join(' · ')}
              </p>
            </>
          ) : latestMrp != null ? (
            <>
              <p className="pick-metric-value mt-1 font-mono font-extrabold tracking-tight text-[var(--content-warning-on-light)]">
                ₹{Math.round(latestMrp)}
              </p>
              <p className="text-[9px] font-medium text-[var(--content-warning-on-light)]">
                {PICKER_MRP_TAP_TO_CONFIRM}
              </p>
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

      {finalMrp != null && !splitActive && (
        <div
          className={`mx-2.5 mb-2.5 flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 sm:mx-3 sm:mb-3 sm:px-2.5 sm:py-2 ${
            mrpFlagged
              ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]'
              : 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)]'
          }`}
        >
          <span className="shrink-0 text-xs">{mrpFlagged ? '⚠' : '✓'}</span>
          <p
            className={`min-w-0 flex-1 text-[10px] font-semibold leading-snug sm:text-[11px] ${
              mrpFlagged ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-positive)]'
            }`}
          >
            {mrpFlagged
              ? `${PICKER_MRP_VS_SUGGESTED(Math.round(finalMrp), Math.round(latestMrp ?? 0))} · billing may review`
              : PICKER_MRP_CONFIRMED(Math.round(finalMrp))}
          </p>
          <button type="button" onClick={onEditMrp} className="shrink-0 text-[10px] font-semibold opacity-80 pick-pressable">
            Change MRP
          </button>
          {onUndoPick ? (
            <button
              type="button"
              onClick={onUndoPick}
              className="shrink-0 text-[10px] font-semibold text-[var(--content-secondary)] pick-pressable"
            >
              Undo pick
            </button>
          ) : null}
        </div>
      )}

      {pickedQty > 0 && (onUndoQty ?? onUndoPick) && finalMrp == null && !splitActive && (
        <div className="mx-2.5 mb-2.5 flex justify-end sm:mx-3 sm:mb-3">
          <button
            type="button"
            onClick={onUndoQty ?? onUndoPick}
            className="text-[10px] font-semibold text-[var(--content-secondary)] pick-pressable"
          >
            Undo qty · start over
          </button>
        </div>
      )}
    </div>
  );
}
