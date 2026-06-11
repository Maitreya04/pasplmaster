import { BottomSheet } from '../shared';
import { UomBadge } from './UomBadge';
import { normalizeUom } from '../../lib/picking/pickerMicrocopy';
import type { PickerV10LoggedBatch, PickerV10Line } from './types';

export interface ItemCompleteOverlayProps {
  isOpen: boolean;
  item: PickerV10Line;
  loggedBatches: PickerV10LoggedBatch[];
  totalLoggedQty: number;
  nextItem?: PickerV10Line | null;
  onPickNext: () => void;
  onSeeRackList: () => void;
  onClose?: () => void;
}

export function ItemCompleteOverlay({
  isOpen,
  item,
  loggedBatches,
  totalLoggedQty,
  nextItem,
  onPickNext,
  onSeeRackList,
  onClose,
}: ItemCompleteOverlayProps): React.JSX.Element {
  const uomNorm = normalizeUom(item.uom);

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose ?? onSeeRackList}
      title="Item complete"
      closeOnly
      footer={
        <div className="space-y-2">
          <button
            type="button"
            onClick={onPickNext}
            className="w-full min-h-[52px] rounded-2xl bg-[var(--bg-inverse-primary)] text-base font-extrabold text-white pick-pressable"
          >
            Pick next item
          </button>
          <button
            type="button"
            onClick={onSeeRackList}
            className="w-full min-h-[44px] text-sm font-semibold text-[var(--content-tertiary)] pick-pressable"
          >
            See full rack list
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] p-4">
          <p className="font-mono text-lg font-bold text-[var(--content-primary)]">{item.code}</p>
          <p className="mt-1 text-sm text-[var(--content-secondary)]">{item.name}</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="font-mono text-2xl font-extrabold tabular-nums text-[var(--content-positive)]">
              {totalLoggedQty}
            </span>
            <UomBadge uom={uomNorm} />
            <span className="text-xs text-[var(--content-tertiary)]">of {item.qty} ordered</span>
          </div>
        </div>

        {loggedBatches.length > 0 ? (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Logged batches
            </p>
            <div className="flex flex-wrap gap-1.5">
              {loggedBatches.map((b, i) => (
                <span
                  key={`${b.mrp}-${b.qty}-${i}`}
                  className="inline-flex flex-col gap-0.5 rounded-lg border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-2.5 py-1.5 text-[10px] font-semibold text-[var(--content-positive)]"
                >
                  <span className="font-mono tabular-nums">
                    ₹{Math.round(b.mrp)} · {b.qty} {uomNorm.toLowerCase()}
                  </span>
                  {b.picker_note ? (
                    <span className="max-w-[140px] truncate font-normal text-[var(--content-secondary)]">
                      {b.picker_note}
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {nextItem ? (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Next up
            </p>
            <p className="mt-1 font-mono text-sm font-bold text-[var(--content-primary)]">{nextItem.code}</p>
            <p className="text-xs text-[var(--content-secondary)]">
              {nextItem.rack ? `Rack ${nextItem.rack}` : '—'} · {nextItem.qty} {uomNorm.toLowerCase()}
            </p>
          </div>
        ) : (
          <p className="text-center text-sm font-medium text-[var(--content-positive)]">
            Last item on this rack ✓
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
