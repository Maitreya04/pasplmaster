import {
  MRP_METRIC_LABEL,
  PICKER_MRP_BILLING_REVIEW,
  PICKER_MRP_CONFIRMED,
  PICKER_MRP_TAP_TO_CONFIRM,
  PICKER_MRP_VS_SUGGESTED,
} from '../../lib/billing/mrpWorkflowCopy';
import type { StockMrpHistoryEntry } from '../../types';
import type { PickerV10Line } from './types';

export interface PickItemCardProps {
  item: PickerV10Line;
  itemIndex: number;
  total: number;
  verified: boolean;
  confirming: boolean;
  confirmedMrp: number | null;
  customMrp: number | null;
  editedQty: number | null;
  outOfStock: boolean;
  mrpHistory: StockMrpHistoryEntry[];
  onEditQty: () => void;
  onEditMrp: () => void;
}

function locationLine(item: PickerV10Line): string {
  const parts = [
    item.rack ? `Rack ${item.rack}` : null,
    item.shelf ?? null,
    item.bin ? `Bin ${item.bin}` : null,
  ].filter(Boolean);
  return parts.join(' · ') || '—';
}

export function PickItemCard({
  item,
  itemIndex,
  total,
  verified,
  confirming,
  confirmedMrp,
  customMrp,
  editedQty,
  outOfStock,
  mrpHistory,
  onEditQty,
  onEditMrp,
}: PickItemCardProps): React.JSX.Element {
  const latestMrp = mrpHistory[0]?.mrp ?? null;
  const finalMrp = customMrp ?? confirmedMrp;
  const mrpFlagged = finalMrp != null && latestMrp != null && finalMrp !== latestMrp;
  const isMultiMrp = mrpHistory.length > 1;
  const dispQty = outOfStock ? 0 : (editedQty ?? item.qty);

  return (
    <div
      className={`mx-4 overflow-hidden rounded-2xl border transition-all duration-300 ${
        confirming
          ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
      }`}
    >
      <div className="flex items-center gap-2 border-b border-[var(--border-faint)] px-5 py-3">
        <span className="text-sm">📍</span>
        <span className="text-xs font-semibold text-[var(--content-secondary)]">{locationLine(item)}</span>
        {verified && (
          <span className="ml-auto text-[11px] font-semibold text-[var(--content-positive)]">✓ verified</span>
        )}
      </div>

      <div className="px-5 pb-3.5 pt-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
          Item {itemIndex + 1} of {total}
        </p>
        <p className="font-mono text-4xl font-extrabold leading-none tracking-tight text-[var(--content-primary)]">
          {item.code}
        </p>
        <p className="mt-1.5 text-sm leading-snug text-[var(--content-secondary)]">{item.name}</p>
      </div>

      <div className="flex border-y border-[var(--border-faint)]">
        <button
          type="button"
          onClick={onEditQty}
          className="relative flex-1 border-r border-[var(--border-faint)] px-5 py-3.5 text-left pick-pressable"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            Pick qty
          </p>
          {outOfStock ? (
            <p className="mt-1 text-sm font-bold text-[var(--content-negative)]">Out of stock</p>
          ) : (
            <div className="mt-1 flex items-baseline gap-1">
              <span
                className={`font-mono text-3xl font-extrabold tracking-tight ${
                  editedQty != null ? 'text-[var(--content-accent)]' : 'text-[var(--content-primary)]'
                }`}
              >
                {dispQty}
              </span>
              <span className="text-xs text-[var(--content-tertiary)]">pcs</span>
            </div>
          )}
          {editedQty != null && !outOfStock && (
            <p className="text-[9px] font-semibold text-[var(--content-accent)]">of {item.qty} target</p>
          )}
          <span className="absolute right-3 top-3 text-xs text-[var(--border-opaque)]">✎</span>
        </button>

        <button
          type="button"
          onClick={onEditMrp}
          disabled={!verified}
          className="relative flex-1 px-5 py-3.5 text-left pick-pressable disabled:opacity-40"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            {MRP_METRIC_LABEL}
          </p>

          {finalMrp != null ? (
            <>
              <p
                className={`mt-1 font-mono text-3xl font-extrabold tracking-tight ${
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
                {mrpFlagged
                  ? PICKER_MRP_VS_SUGGESTED(Math.round(finalMrp), Math.round(latestMrp ?? 0))
                  : 'matches suggestion ✓'}
              </p>
            </>
          ) : isMultiMrp ? (
            <>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-[11px] font-bold text-[var(--content-warning-on-light)]">⚠</span>
                <span className="text-xs font-bold text-[var(--content-warning-on-light)]">Multiple found</span>
              </div>
              <p className="mt-1 text-[10px] leading-snug text-[var(--content-tertiary)]">
                {mrpHistory.map((h) => `₹${Math.round(h.mrp)}`).join(' · ')}
              </p>
              <p className="text-[9px] font-semibold text-[var(--content-warning-on-light)]">
                Tap to confirm which →
              </p>
            </>
          ) : latestMrp != null ? (
            <>
              <p className="mt-1 font-mono text-3xl font-extrabold tracking-tight text-[var(--content-warning-on-light)]">
                ₹{Math.round(latestMrp)}
              </p>
              <p className="text-[9px] text-[var(--content-tertiary)]">{PICKER_MRP_TAP_TO_CONFIRM}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-[var(--content-tertiary)]">No MRP data</p>
          )}

          <span
            className={`absolute right-3 top-3 text-xs ${
              finalMrp != null
                ? mrpFlagged
                  ? 'text-[var(--border-warning)]'
                  : 'text-[var(--border-positive)]'
                : 'text-[var(--border-opaque)]'
            }`}
          >
            {finalMrp != null ? (mrpFlagged ? '⚠' : '✓') : '✎'}
          </span>
        </button>
      </div>

      {finalMrp != null && (
        <div
          className={`mx-5 my-3 flex items-center gap-2 rounded-lg border px-3 py-2 ${
            mrpFlagged
              ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]'
              : 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)]'
          }`}
        >
          <span className="text-sm">{mrpFlagged ? '⚠️' : '✅'}</span>
          <div className="min-w-0 flex-1">
            <p
              className={`text-xs font-semibold ${
                mrpFlagged ? 'text-[var(--content-warning-on-light)]' : 'text-[var(--content-positive)]'
              }`}
            >
              {mrpFlagged
                ? PICKER_MRP_BILLING_REVIEW
                : PICKER_MRP_CONFIRMED(Math.round(finalMrp))}
            </p>
            {isMultiMrp && !mrpFlagged && (
              <p className="text-[10px] text-[var(--content-positive)] opacity-70">
                Matches record from {mrpHistory.find((h) => h.mrp === finalMrp)?.date ?? 'system'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onEditMrp}
            className="shrink-0 text-[11px] opacity-60 pick-pressable"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
