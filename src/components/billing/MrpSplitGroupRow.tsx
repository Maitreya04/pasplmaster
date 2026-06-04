import { Check, Trash } from '@phosphor-icons/react';
import {
  billLineFlagChipClasses,
  billLineResolvedStripeClasses,
  billLineStripeClasses,
} from '../../lib/billing/billLineRowStyle';
import { deskLineFlagAccent, deskLineFlagKind } from '../../lib/billing/deskLineFlagKind';
import { resolvedLabelPriceForBilling } from '../../lib/billing/labelMrpFlag';
import {
  readPickMrpSnapshot,
  labelDiffersFromBillingRate,
  pickMrpQtyBandsForGroup,
  formatPickMrpQtyBreakdown,
} from '../../lib/billing/pickMrpBillingContext';
import type { OrderItemDisplayGroup } from '../../lib/billing/orderItemSplitGroups';
import {
  BILLING_ACCEPT_LABEL,
  BILLING_KEEP_QUOTED,
  formatRoundedRs,
} from '../../lib/billing/mrpWorkflowCopy';
import { orderItemDisplayName } from '../../utils/formatters';
import type { OrderItem } from '../../types';
import type { OverlayLineEdit, OverlayLineResolution } from '../../pages/billing/BillingDesk/types';

function resolutionSuffix(resolution: OverlayLineResolution | null): string | null {
  if (resolution === 'accept_price') return 'accepted';
  if (resolution === 'keep_quoted') return 'kept';
  if (resolution === 'manual_override') return 'edited';
  if (resolution === 'removed') return 'removed';
  return null;
}

function lineQty(item: OrderItem): number {
  if (item.qty_shippable != null && item.qty_shippable > 0) return item.qty_shippable;
  if (item.scan_result?.progress?.pickedQty != null && item.scan_result.progress.pickedQty > 0)
    return item.scan_result.progress.pickedQty;
  return Math.max(0, item.qty_requested ?? 0);
}

interface BatchRowProps {
  item: OrderItem;
  edit: OverlayLineEdit;
  billingRate: number;
  isLast: boolean;
  onAcceptPrice: () => void;
  onKeepQuoted: () => void;
  onRemove: () => void;
  onUndoRemove: () => void;
  showUndoRemove?: boolean;
}

/**
 * Single batch line inside a split-pick group. Shows qty · label MRP · match status
 * and action buttons only when label ≠ billing rate.
 */
function SplitBatchRow({
  item,
  edit,
  billingRate,
  isLast,
  onAcceptPrice,
  onKeepQuoted,
  onRemove,
  onUndoRemove,
  showUndoRemove,
}: BatchRowProps): React.JSX.Element {
  const snapshot = readPickMrpSnapshot(item);
  const labelMrp = snapshot.labelMrp;
  const labelPrice = resolvedLabelPriceForBilling(item, labelMrp);
  const billDiffers = labelDiffersFromBillingRate(snapshot);
  const kind = deskLineFlagKind(item.flag_reason);
  const accent = deskLineFlagAccent(item.flag_reason);
  const isResolved = edit.resolution != null;
  const isRemoved = edit.resolution === 'removed' || edit.removed;
  const showPriceAccept = !isResolved && kind === 'price' && labelPrice != null;
  const showOosKeep = !isResolved && kind === 'oos';
  const suffix = resolutionSuffix(edit.resolution);
  const qty = lineQty(item);

  const baseClasses = [
    'flex items-start justify-between gap-2 px-3 py-2 border-l-[3px]',
    !isLast ? 'border-b border-[var(--border-faint)]' : '',
    isResolved && !isRemoved
      ? billLineResolvedStripeClasses()
      : isRemoved
        ? 'bg-[var(--bg-tertiary)]/40'
        : billDiffers || kind === 'price'
          ? billLineStripeClasses(accent)
          : 'border-l-[var(--border-positive)] bg-[var(--bg-positive-subtle)]/30',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={baseClasses}>
      {/* Left: qty + label MRP + match status */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="tabular-nums text-[11px] font-semibold text-[var(--content-primary)]">
            {qty} pcs
          </span>
          {labelMrp != null ? (
            <>
              <span className="text-[var(--content-tertiary)] text-[10px]">·</span>
              <span
                className={`text-[11px] font-semibold tabular-nums ${
                  billDiffers
                    ? 'text-[var(--content-warning-on-light)]'
                    : 'text-[var(--content-positive)]'
                }`}
              >
                Label {formatRoundedRs(labelMrp)}
              </span>
              {billDiffers ? (
                <span className="text-[9px] text-[var(--content-tertiary)]">
                  · bill {formatRoundedRs(billingRate)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-[var(--content-positive)]">
                  <Check size={9} weight="bold" />
                  matches
                </span>
              )}
            </>
          ) : null}
          {suffix ? (
            <span className={`font-ds-micro font-semibold px-1 py-px rounded-full border whitespace-nowrap ${billLineFlagChipClasses(accent)}`}>
              {suffix}
            </span>
          ) : null}
        </div>
      </div>

      {/* Right: action buttons */}
      <div className="flex shrink-0 items-center gap-1">
        {showPriceAccept && (
          <>
            <button
              type="button"
              onClick={onAcceptPrice}
              title={`Bill these ${qty} pcs at ${formatRoundedRs(labelPrice!)}`}
              className="h-6 px-1.5 rounded-md text-[9px] font-semibold leading-none bg-[var(--bg-positive)] text-white hover:opacity-90 whitespace-nowrap"
            >
              {BILLING_ACCEPT_LABEL} {formatRoundedRs(labelPrice!)}
            </button>
            <button
              type="button"
              onClick={onKeepQuoted}
              title={`Keep quoted ${formatRoundedRs(billingRate)}`}
              className="h-6 px-1.5 rounded-md text-[9px] font-medium leading-none border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] whitespace-nowrap"
            >
              {BILLING_KEEP_QUOTED}
            </button>
          </>
        )}
        {showOosKeep && (
          <>
            <button
              type="button"
              onClick={onKeepQuoted}
              className="h-6 px-1.5 rounded-md text-[9px] font-semibold leading-none bg-[var(--bg-positive)] text-white hover:opacity-90 whitespace-nowrap"
            >
              {BILLING_KEEP_QUOTED}
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex h-6 items-center gap-0.5 px-1.5 rounded-md text-[9px] font-medium leading-none border border-[var(--border-negative)] text-[var(--content-negative)] hover:bg-[var(--bg-negative-subtle)] whitespace-nowrap"
            >
              <Trash size={10} weight="bold" />
              Remove
            </button>
          </>
        )}
        {isResolved && !isRemoved && (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-[var(--content-positive)]">
            <Check size={10} weight="bold" />
            Done
          </span>
        )}
        {isRemoved && showUndoRemove && (
          <button
            type="button"
            onClick={onUndoRemove}
            className="text-[9px] font-semibold text-[var(--content-accent)] hover:underline whitespace-nowrap"
          >
            Undo
          </button>
        )}
        {!billDiffers && !isResolved && kind !== 'oos' && labelMrp != null && (
          <span className="text-[9px] text-[var(--content-tertiary)] whitespace-nowrap">no action</span>
        )}
      </div>
    </div>
  );
}

export interface MrpSplitGroupRowProps {
  group: OrderItemDisplayGroup;
  /** All edits keyed by item id */
  edits: Record<number, OverlayLineEdit>;
  flaggedItemIds: Set<number>;
  undoRemoveId: number | null;
  onAcceptPrice: (item: OrderItem) => void;
  onKeepQuoted: (item: OrderItem) => void;
  onRemoveFlagged: (item: OrderItem) => void;
  onUndoRemove: (itemId: number) => void;
}

/**
 * Renders a single order line that was split at pick time as a grouped block:
 * - one header showing the item name, total qty ordered, and billing rate
 * - one sub-row per batch (root + each split sibling)
 * - only flagged batches show action buttons; matching batches show a quiet ✓
 *
 * This keeps the billing person's mental model intact: "I'm looking at 10 pcs of
 * Item X — 6 matched at ₹1,000, 4 are ₹900 and need a decision."
 */
export function MrpSplitGroupRow({
  group,
  edits,
  flaggedItemIds,
  undoRemoveId,
  onAcceptPrice,
  onKeepQuoted,
  onRemoveFlagged,
  onUndoRemove,
}: MrpSplitGroupRowProps): React.JSX.Element {
  const { root, siblings } = group;
  const allLines = [root, ...siblings];

  const rootEdit = edits[root.id];
  const billingRate =
    readPickMrpSnapshot(root).billingRateAtPick ??
    (root.price_quoted ?? root.price_system ?? 0);

  const totalQtyOrdered = allLines.reduce(
    (s, l) => s + (l.qty_requested ?? 0),
    0,
  );

  const bands = pickMrpQtyBandsForGroup(root, siblings);
  const mixLabel = formatPickMrpQtyBreakdown(bands, totalQtyOrdered > 0 ? totalQtyOrdered : undefined);

  const allResolved = allLines.every((l) => {
    const e = edits[l.id];
    return e?.resolution != null || e?.removed;
  });

  const anyFlagged = allLines.some((l) => flaggedItemIds.has(l.id));
  const flaggedCount = allLines.filter((l) => {
    const snap = readPickMrpSnapshot(l);
    return labelDiffersFromBillingRate(snap) && snap.labelMrp != null;
  }).length;

  return (
    <div className="border-t border-[var(--border-faint)]">
      {/* Group header */}
      <div className="flex items-start justify-between gap-2 px-2.5 py-2 bg-[var(--bg-tertiary)]">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <p
              className="text-xs font-medium text-[var(--content-primary)] truncate min-w-0"
              title={orderItemDisplayName(root)}
            >
              {orderItemDisplayName(root)}
            </p>
            <span className="shrink-0 text-[9px] font-semibold text-[var(--content-tertiary)] whitespace-nowrap">
              {allLines.length} batch{allLines.length === 1 ? '' : 'es'} picked
            </span>
            {anyFlagged && !allResolved && (
              <span className={`shrink-0 font-ds-micro font-semibold px-1 py-px rounded-full border whitespace-nowrap ${billLineFlagChipClasses('blue')}`}>
                {flaggedCount} price {flaggedCount === 1 ? 'flag' : 'flags'}
              </span>
            )}
            {allResolved && (
              <span className="inline-flex shrink-0 items-center gap-0.5 text-[9px] font-semibold text-[var(--content-positive)]">
                <Check size={9} weight="bold" />
                all resolved
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[9px] text-[var(--content-tertiary)]">
              {totalQtyOrdered} pcs ordered
            </span>
            <span className="text-[9px] text-[var(--content-quaternary)]">·</span>
            <span className="text-[9px] font-medium text-[var(--content-secondary)]">
              Bill rate {formatRoundedRs(billingRate)}
            </span>
            {mixLabel && (
              <>
                <span className="text-[9px] text-[var(--content-quaternary)]">·</span>
                <span className="text-[9px] text-[var(--content-tertiary)]">{mixLabel}</span>
              </>
            )}
          </div>
        </div>
        {rootEdit?.priceQuoted != null && (
          <input
            type="number"
            inputMode="decimal"
            value={rootEdit.priceQuoted}
            readOnly
            className="w-14 h-6 px-1 text-[10px] rounded border border-[var(--border-subtle)] bg-[var(--bg-secondary)] tabular-nums text-[var(--content-tertiary)]"
            title="Bill rate"
          />
        )}
      </div>

      {/* One sub-row per batch */}
      {allLines.map((line, idx) => {
        const edit = edits[line.id];
        if (!edit) return null;
        return (
          <SplitBatchRow
            key={line.id}
            item={line}
            edit={edit}
            billingRate={billingRate}
            isLast={idx === allLines.length - 1}
            onAcceptPrice={() => onAcceptPrice(line)}
            onKeepQuoted={() => onKeepQuoted(line)}
            onRemove={() => onRemoveFlagged(line)}
            onUndoRemove={() => onUndoRemove(line.id)}
            showUndoRemove={undoRemoveId === line.id}
          />
        );
      })}
    </div>
  );
}
