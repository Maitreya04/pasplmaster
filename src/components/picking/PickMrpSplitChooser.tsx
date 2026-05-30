import type { StockMrpHistoryEntry } from '../../types';
import {
  PICKER_MRP_SPLIT_CHOOSER_AUTO_STOCK,
  PICKER_MRP_SPLIT_CHOOSER_HEADING,
  PICKER_MRP_SPLIT_CHOOSER_MANUAL_STOCK,
  PICKER_MRP_SPLIT_CHOOSER_SINGLE_HINT,
  PICKER_MRP_SPLIT_CHOOSER_SPLIT_HINT,
  PICKER_MRP_SPLIT_CHOOSER_SPLIT_LABEL,
  formatRoundedRs,
} from '../../lib/billing/mrpWorkflowCopy';

export interface PickMrpSplitChooserProps {
  targetQty: number;
  mrpHistory: StockMrpHistoryEntry[];
  mrpLoading?: boolean;
  /** Stock / shelf shows multiple MRP bands. */
  autoDetected?: boolean;
  splitMrpBands?: number;
  latestMrp: number | null;
  disabled?: boolean;
  onStartSplit: () => void;
  onConfirmSingle: () => void;
}

function stockSummary(
  history: StockMrpHistoryEntry[],
  latestMrp: number | null,
  autoDetected: boolean,
  splitMrpBands: number,
  loading: boolean,
): string {
  if (loading && history.length === 0) return 'Loading stock prices…';
  if (autoDetected && history.length > 1) {
    const prices = history.slice(0, 4).map((h) => formatRoundedRs(h.mrp));
    const extra = history.length > 4 ? ` +${history.length - 4}` : '';
    return PICKER_MRP_SPLIT_CHOOSER_AUTO_STOCK(prices.join(' · ') + extra);
  }
  if (latestMrp != null) {
    return PICKER_MRP_SPLIT_CHOOSER_MANUAL_STOCK(formatRoundedRs(latestMrp));
  }
  if (splitMrpBands > 1) {
    return PICKER_MRP_SPLIT_CHOOSER_AUTO_STOCK(`${splitMrpBands} prices on shelf`);
  }
  return 'No stock price on file — enter from the label';
}

export function PickMrpSplitChooser({
  targetQty,
  mrpHistory,
  mrpLoading = false,
  autoDetected = false,
  splitMrpBands = 0,
  latestMrp,
  disabled = false,
  onStartSplit,
  onConfirmSingle,
}: PickMrpSplitChooserProps): React.JSX.Element {
  const stockLine = stockSummary(
    mrpHistory,
    latestMrp,
    autoDetected,
    splitMrpBands,
    mrpLoading,
  );
  const singleLabel =
    latestMrp != null
      ? `Same price on all ${targetQty} pcs · ${formatRoundedRs(latestMrp)}`
      : `Same label price on all ${targetQty} pcs`;

  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-2xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] sm:mx-4">
      <div className="border-b border-[var(--border-warning)]/25 px-3 py-2.5 sm:px-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-warning-on-light)]/80">
          {PICKER_MRP_SPLIT_CHOOSER_HEADING(targetQty)}
        </p>
        <p className="mt-1 text-xs font-medium leading-snug text-[var(--content-warning-on-light)]">
          {stockLine}
        </p>
      </div>

      <div className="flex flex-col gap-2 p-2.5 sm:p-3">
        <button
          type="button"
          disabled={disabled}
          onClick={onStartSplit}
          className="flex w-full min-h-[52px] items-center justify-between gap-3 rounded-xl bg-[var(--bg-inverse-primary)] px-3.5 py-3 text-left pick-pressable active:scale-[0.99] disabled:opacity-40 sm:min-h-[56px] sm:px-4"
        >
          <div className="min-w-0">
            <p className="text-sm font-extrabold leading-snug text-white sm:text-base">
              {PICKER_MRP_SPLIT_CHOOSER_SPLIT_LABEL}
            </p>
            <p className="mt-0.5 text-[10px] leading-snug text-white/70 sm:text-[11px]">
              {PICKER_MRP_SPLIT_CHOOSER_SPLIT_HINT}
            </p>
          </div>
          <span className="shrink-0 text-lg text-white/80">›</span>
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={onConfirmSingle}
          className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3.5 py-2.5 text-left pick-pressable active:scale-[0.99] disabled:opacity-40 sm:px-4"
        >
          <p className="text-sm font-bold text-[var(--content-primary)]">{singleLabel}</p>
          <p className="mt-0.5 text-[10px] text-[var(--content-tertiary)]">
            {PICKER_MRP_SPLIT_CHOOSER_SINGLE_HINT}
          </p>
        </button>
      </div>
    </div>
  );
}
