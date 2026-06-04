import type { StockMrpHistoryEntry } from '../../types';
import type { PickLineMrpState } from '../../lib/picking/pickLineMrp';
import {
  MRP_METRIC_LABEL,
  PICKER_MRP_BILL_RATE_CHIP,
  PICKER_MRP_BILL_REVIEW,
  PICKER_MRP_CONFIRMED,
  PICKER_MRP_LABEL_ON_PRODUCT,
  PICKER_MRP_STOCK_CHIP,
  PICKER_MRP_STOCK_SUGGESTS,
  PICKER_MRP_TAP_TO_CONFIRM,
  PICKER_MRP_VS_BILL,
} from '../../lib/billing/mrpWorkflowCopy';
import {
  getActiveSegmentMrp,
  isSplitMode,
  pickLineSegmentsCommittedQty,
} from '../../lib/picking/pickLineMrp';
import {
  isPickLabelVsBillingMismatch,
  pickMetricMrpFlagged,
} from '../../lib/picking/pickMrpDisplay';

export interface PickMetricRowProps {
  /** Pieces left to pick on this line. */
  displayQty: number;
  targetQty: number;
  pickedQty: number;
  mrpHistory: StockMrpHistoryEntry[];
  mrpLoading?: boolean;
  /** Order billing rate (quoted → system). */
  billingRate?: number | null;
  confirmedMrp: number | null;
  customMrp: number | null;
  lineMrp?: PickLineMrpState;
  splitActive?: boolean;
  disabled?: boolean;
  onEditQty: () => void;
  onEditMrp: () => void;
  /** Reset qty progress on this line (wrong pick / wrong qty). */
  onUndoPick?: () => void;
  /** Qty-only reset when MRP is not yet confirmed. */
  onUndoQty?: () => void;
}

function PickMrpPriceContext({
  labelMrp,
  billingRate,
  stockMrp,
  billingMismatch,
  stockMismatch,
}: {
  labelMrp: number;
  billingRate: number | null;
  stockMrp: number | null;
  billingMismatch: boolean;
  stockMismatch: boolean;
}): React.JSX.Element {
  const warn = billingMismatch || stockMismatch;
  return (
    <div
      className={`mx-2.5 mb-2.5 rounded-lg border px-2.5 py-2 sm:mx-3 sm:mb-3 ${
        warn
          ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]'
          : 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)]'
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
            billingMismatch
              ? 'border-[var(--border-warning)] text-[var(--content-warning-on-light)]'
              : 'border-[var(--border-subtle)] text-[var(--content-primary)]'
          }`}
        >
          {PICKER_MRP_LABEL_ON_PRODUCT(labelMrp)}
        </span>
        {billingRate != null ? (
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
              billingMismatch
                ? 'border-[var(--border-warning)] bg-[var(--bg-secondary)] text-[var(--content-warning-on-light)]'
                : 'border-[var(--border-subtle)] text-[var(--content-secondary)]'
            }`}
          >
            {PICKER_MRP_BILL_RATE_CHIP(billingRate)}
          </span>
        ) : null}
        {stockMrp != null ? (
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
              stockMismatch
                ? 'border-[var(--border-warning)] bg-[var(--bg-secondary)] text-[var(--content-warning-on-light)]'
                : 'border-[var(--border-subtle)] text-[var(--content-secondary)]'
            }`}
          >
            {PICKER_MRP_STOCK_CHIP(stockMrp)}
          </span>
        ) : null}
      </div>
      <p
        className={`mt-1.5 text-[10px] font-semibold leading-snug sm:text-[11px] ${
          billingMismatch
            ? 'text-[var(--content-warning-on-light)]'
            : stockMismatch
              ? 'text-[var(--content-warning-on-light)]'
              : 'text-[var(--content-positive)]'
        }`}
      >
        {stockMismatch && stockMrp != null
          ? `Label ₹${labelMrp} · shelf ₹${stockMrp} — billing will review`
          : billingMismatch && billingRate != null
            ? PICKER_MRP_BILL_REVIEW(labelMrp, billingRate)
            : PICKER_MRP_CONFIRMED(labelMrp)}
      </p>
    </div>
  );
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
  billingRate = null,
  confirmedMrp,
  customMrp,
  lineMrp,
  splitActive: splitActiveProp = false,
  disabled = false,
  onEditQty,
  onEditMrp,
  onUndoPick,
  onUndoQty,
}: PickMetricRowProps): React.JSX.Element {
  const splitActive = splitActiveProp || isSplitMode(lineMrp);
  const activeMrp = splitActive ? getActiveSegmentMrp(lineMrp) : null;
  const stockMrp = mrpHistory[0]?.mrp ?? null;
  const rawLabelMrp = splitActive ? activeMrp : (customMrp ?? confirmedMrp);
  const finalMrp = rawLabelMrp != null ? Math.round(rawLabelMrp) : null;
  const stockRounded = stockMrp != null ? Math.round(stockMrp) : null;
  const billingMismatch = isPickLabelVsBillingMismatch(finalMrp, billingRate ?? null);
  const mrpNeedsReview = pickMetricMrpFlagged(finalMrp, stockRounded);
  const stockMismatch = mrpNeedsReview;
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
          className={`relative min-w-0 flex-1 px-2.5 py-2.5 text-left pick-pressable disabled:opacity-50 sm:px-4 sm:py-3 ${
            splitActive && finalMrp == null ? 'bg-[var(--bg-warning-subtle)]/50' : ''
          }`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            {splitActive ? 'Label on batch' : MRP_METRIC_LABEL}
          </p>

          {mrpLoading ? (
            <p className="mt-2 text-xs text-[var(--content-tertiary)]">Loading…</p>
          ) : finalMrp != null ? (
            <>
              <p
                className={`pick-metric-value mt-1 font-mono font-extrabold tracking-tight ${
                  mrpNeedsReview ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-positive)]'
                }`}
              >
                ₹{finalMrp}
              </p>
              <p
                className={`text-[9px] font-semibold ${
                  mrpNeedsReview ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-positive)]'
                }`}
              >
                {splitActive
                  ? PICKER_MRP_LABEL_ON_PRODUCT(finalMrp)
                  : billingMismatch && billingRate != null
                    ? PICKER_MRP_VS_BILL(finalMrp, billingRate)
                    : 'on label ✓'}
              </p>
            </>
          ) : splitActive ? (
            <>
              <p className="mt-1.5 text-xs font-bold text-[var(--content-warning-on-light)]">
                Enter label price
              </p>
              <p className="text-[10px] leading-snug text-[var(--content-tertiary)]">
                Tap or use dock below
              </p>
            </>
          ) : isMultiMrp ? (
            <>
              <p className="mt-1.5 text-xs font-bold text-[var(--content-warning-on-light)]">
                {mrpHistory.length} on shelf
              </p>
              <p className="text-[10px] leading-snug text-[var(--content-tertiary)] line-clamp-2 break-words">
                {mrpHistory.map((h) => `₹${Math.round(h.mrp)}`).join(' · ')}
              </p>
            </>
          ) : stockMrp != null ? (
            <>
              <p className="mt-1.5 text-xs font-bold text-[var(--content-warning-on-light)]">
                {PICKER_MRP_TAP_TO_CONFIRM}
              </p>
              <p className="pick-metric-value mt-0.5 font-mono text-lg font-extrabold tracking-tight text-[var(--content-tertiary)]">
                {PICKER_MRP_STOCK_SUGGESTS(Math.round(stockMrp))}
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs text-[var(--content-tertiary)]">Tap to enter label price</p>
          )}

          <span
            className={`absolute right-2.5 top-2.5 text-[10px] ${
              finalMrp != null
                ? mrpNeedsReview
                  ? 'text-[var(--border-warning)]'
                  : 'text-[var(--border-positive)]'
                : stockMrp != null || splitActive
                  ? 'text-[var(--border-warning)]'
                  : 'text-[var(--border-opaque)]'
            }`}
          >
            {finalMrp != null ? (mrpNeedsReview ? '⚠' : '✓') : '✎'}
          </span>
        </button>
      </div>

      {finalMrp != null ? (
        <PickMrpPriceContext
          labelMrp={finalMrp}
          billingRate={billingRate ?? null}
          stockMrp={stockMrp != null ? Math.round(stockMrp) : null}
          billingMismatch={billingMismatch}
          stockMismatch={stockMismatch}
        />
      ) : null}

      {finalMrp != null && !splitActive && (
        <div className="mx-2.5 mb-2.5 flex justify-end gap-2 sm:mx-3 sm:mb-3">
          <button type="button" onClick={onEditMrp} className="text-[10px] font-semibold opacity-80 pick-pressable">
            Change label
          </button>
          {onUndoPick ? (
            <button
              type="button"
              onClick={onUndoPick}
              className="text-[10px] font-semibold text-[var(--content-secondary)] pick-pressable"
            >
              Undo
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
