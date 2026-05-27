import { Check, Trash } from '@phosphor-icons/react';
import {
  deskLineFlagAccent,
  deskLineFlagChipLabel,
  deskLineFlagKind,
} from '../../../lib/billing/deskLineFlagKind';
import { orderItemDisplayName } from '../../../utils/formatters';
import { orderItemConfirmedMrp } from '../../../lib/billing/orderItemSplitGroups';
import type { OrderItem } from '../../../types';
import type { OverlayLineEdit, OverlayLineResolution } from './types';

const FLAGGED_GRID =
  'grid grid-cols-[minmax(0,1fr)_32px_64px_minmax(88px,max-content)] gap-x-1.5 items-center';

function accentBorderClass(accent: ReturnType<typeof deskLineFlagAccent>): string {
  if (accent === 'red') return 'border-l-[var(--border-negative)] bg-[var(--bg-negative-subtle)]/35';
  if (accent === 'blue') return 'border-l-[var(--border-accent)] bg-[var(--bg-accent-subtle)]/35';
  return 'border-l-[var(--border-warning)] bg-[var(--bg-warning-subtle)]';
}

function accentChipClass(accent: ReturnType<typeof deskLineFlagAccent>): string {
  if (accent === 'red') {
    return 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] border-[var(--border-negative)]';
  }
  if (accent === 'blue') {
    return 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border-[var(--border-accent)]';
  }
  return 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)] border-[var(--border-warning)]';
}

function formatRs(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function resolutionSuffix(resolution: OverlayLineResolution | null): string | null {
  if (resolution === 'accept_price') return 'accepted';
  if (resolution === 'keep_quoted') return 'kept';
  if (resolution === 'manual_override') return 'edited';
  if (resolution === 'removed') return 'removed';
  return null;
}

export function DeskFlaggedSectionHeader(): React.JSX.Element {
  return (
    <div
      className={`${FLAGGED_GRID} bg-[var(--bg-tertiary)] px-2.5 py-1.5 text-[9px] font-semibold uppercase text-[var(--content-quaternary)]`}
    >
      <span>Item</span>
      <span className="text-center">Qty</span>
      <span>MRP</span>
      <span className="text-right">Action</span>
    </div>
  );
}

export interface DeskFlaggedLineRowProps {
  item: OrderItem;
  edit: OverlayLineEdit;
  indent?: boolean;
  splitHint?: string;
  onAcceptPrice: () => void;
  onKeepQuoted: () => void;
  onRemove: () => void;
  onUndoRemove: () => void;
  onPriceChange: (price: number) => void;
  showUndoRemove?: boolean;
}

export function DeskFlaggedLineRow({
  item,
  edit,
  indent,
  splitHint,
  onAcceptPrice,
  onKeepQuoted,
  onRemove,
  onUndoRemove,
  onPriceChange,
  showUndoRemove,
}: DeskFlaggedLineRowProps): React.JSX.Element {
  const kind = deskLineFlagKind(item.flag_reason);
  const accent = deskLineFlagAccent(item.flag_reason);
  const isResolved = edit.resolution != null;
  const isRemoved = edit.resolution === 'removed' || edit.removed;
  const labelMrp = orderItemConfirmedMrp(item);
  const quoted = item.price_quoted ?? item.price_system ?? 0;
  const system = item.price_system ?? 0;
  const boxPrice =
    typeof item.flag_box_price === 'number' && !Number.isNaN(item.flag_box_price)
      ? item.flag_box_price
      : null;
  const suffix = resolutionSuffix(edit.resolution);

  const removeTitle =
    kind === 'oos'
      ? 'Remove from order · adds to pending'
      : "Remove & log for warehouse audit";

  return (
    <div
      className={`${FLAGGED_GRID} border-t border-[var(--border-faint)] border-l-2 px-2.5 py-2 ${
        isResolved && !isRemoved
          ? 'border-l-[var(--border-positive)] bg-[var(--bg-positive-subtle)]/25'
          : isRemoved
            ? 'border-l-[var(--border-subtle)] bg-[var(--bg-tertiary)]/70 opacity-80'
            : accentBorderClass(accent)
      } ${indent ? 'pl-4' : ''}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <p
            className={`text-xs truncate min-w-0 ${
              isRemoved
                ? 'text-[var(--content-quaternary)] line-through'
                : 'text-[var(--content-primary)]'
            }`}
            title={orderItemDisplayName(item)}
          >
            {indent ? '↳ ' : ''}
            {orderItemDisplayName(item)}
          </p>
          <span
            className={`shrink-0 text-[8px] font-semibold px-1 py-px rounded-full border whitespace-nowrap ${accentChipClass(accent)}`}
          >
            {deskLineFlagChipLabel(item.flag_reason)}
            {suffix ? ` · ${suffix}` : ''}
          </span>
        </div>
        {splitHint ? (
          <p className="text-[9px] text-[var(--content-quaternary)] truncate mt-0.5">{splitHint}</p>
        ) : null}
        {labelMrp != null && !isRemoved ? (
          <p className="text-[9px] text-[var(--content-quaternary)] truncate mt-0.5">
            Label {formatRs(labelMrp)}
          </p>
        ) : null}
        {kind === 'price' && !isRemoved ? (
          <p className="text-[9px] text-[var(--content-secondary)] truncate mt-0.5">
            {boxPrice != null ? `Box ${formatRs(boxPrice)} · ` : ''}
            Quoted {formatRs(quoted)}
            {system !== quoted ? ` · Sys ${formatRs(system)}` : ''}
          </p>
        ) : null}
        {item.flag_notes ? (
          <p className="text-[9px] text-[var(--content-quaternary)] italic truncate mt-0.5">
            {item.flag_notes}
          </p>
        ) : null}
      </div>

      <span className="text-[11px] text-[var(--content-quaternary)] tabular-nums text-center">
        {item.qty_requested}
      </span>

      {!isRemoved ? (
        <input
          type="number"
          inputMode="decimal"
          value={edit.priceQuoted}
          onChange={(e) => onPriceChange(parseFloat(e.target.value.replace(/,/g, '')) || 0)}
          className={`w-full h-7 px-1 text-[11px] rounded-md border tabular-nums ${
            edit.priceTouched || edit.resolution === 'accept_price'
              ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
          }`}
        />
      ) : (
        <span className="text-[10px] text-[var(--content-quaternary)] text-center">—</span>
      )}

      <div className="flex items-center justify-end gap-1 min-w-0">
        {!isResolved && kind === 'price' ? (
          <>
            {boxPrice != null ? (
              <button
                type="button"
                onClick={onAcceptPrice}
                title={`Accept box price ${formatRs(boxPrice)}`}
                className="h-7 px-1.5 rounded-md text-[9px] font-semibold leading-none bg-[var(--bg-positive)] text-white hover:opacity-95 whitespace-nowrap"
              >
                Accept
              </button>
            ) : null}
            <button
              type="button"
              onClick={onKeepQuoted}
              title={`Keep quoted ${formatRs(quoted)}`}
              className="h-7 px-1.5 rounded-md text-[9px] font-medium leading-none border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] whitespace-nowrap"
            >
              Keep
            </button>
          </>
        ) : null}

        {!isResolved && kind !== 'price' ? (
          <>
            <button
              type="button"
              onClick={onKeepQuoted}
              title={`Keep in order at ${formatRs(edit.priceQuoted)}`}
              className="h-7 px-1.5 rounded-md text-[9px] font-semibold leading-none bg-[var(--bg-positive)] text-white hover:opacity-95 whitespace-nowrap"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={onRemove}
              title={removeTitle}
              className="inline-flex h-7 items-center gap-0.5 px-1.5 rounded-md text-[9px] font-medium leading-none border border-[var(--border-negative)] text-[var(--content-negative)] hover:bg-[var(--bg-negative-subtle)] whitespace-nowrap"
            >
              <Trash size={11} weight="bold" />
              Remove
            </button>
          </>
        ) : null}

        {isResolved && !isRemoved ? (
          <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-[var(--content-positive)]">
            <Check size={12} weight="bold" />
            Done
          </span>
        ) : null}

        {isRemoved && showUndoRemove ? (
          <button
            type="button"
            onClick={onUndoRemove}
            className="text-[9px] font-semibold text-[var(--content-accent)] hover:underline whitespace-nowrap"
          >
            Undo
          </button>
        ) : null}

        {isRemoved && !showUndoRemove ? (
          <span className="text-[9px] text-[var(--content-quaternary)] whitespace-nowrap">Pending</span>
        ) : null}
      </div>
    </div>
  );
}

/** Compact row for non-flagged lines (unchanged desk grid). */
export interface DeskNormalLineRowProps {
  item: OrderItem;
  edit: OverlayLineEdit;
  indent?: boolean;
  splitHint?: string;
  pendingRemoveId: number | null;
  onPriceChange: (price: number) => void;
  onRequestRemove: () => void;
  onConfirmRemove: () => void;
}

export function DeskNormalLineRow({
  item,
  edit,
  indent,
  splitHint,
  pendingRemoveId,
  onPriceChange,
  onRequestRemove,
  onConfirmRemove,
}: DeskNormalLineRowProps): React.JSX.Element | null {
  if (edit.removed) return null;
  const labelMrp = orderItemConfirmedMrp(item);

  return (
    <div
      className={`grid grid-cols-[1fr_50px_78px_38px] gap-0 px-2.5 py-2 border-t border-[var(--border-faint)] items-center ${
        indent ? 'bg-[var(--bg-secondary)]/60 pl-4' : ''
      }`}
    >
      <div className="min-w-0 pr-1">
        <p className="text-xs text-[var(--content-primary)] truncate">
          {indent ? '↳ ' : ''}
          {orderItemDisplayName(item)}
        </p>
        {splitHint ? (
          <span className="mt-0.5 block text-[9px] text-[var(--content-quaternary)]">
            {splitHint}
          </span>
        ) : null}
        {labelMrp != null ? (
          <span className="mt-0.5 block text-[9px] font-medium text-[var(--content-secondary)]">
            Label MRP ₹{Math.round(labelMrp)}
          </span>
        ) : null}
      </div>
      <span className="text-xs text-[var(--content-quaternary)] tabular-nums">
        {item.qty_requested}
      </span>
      <input
        type="number"
        inputMode="decimal"
        value={edit.priceQuoted}
        onChange={(e) => onPriceChange(parseFloat(e.target.value.replace(/,/g, '')) || 0)}
        className={`w-[68px] h-7 px-1.5 text-xs rounded-md border tabular-nums ${
          edit.priceTouched
            ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
            : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)]'
        }`}
      />
      <div className="flex flex-col items-center gap-0.5">
        <button
          type="button"
          onClick={onRequestRemove}
          className="text-[var(--content-quaternary)] hover:text-[var(--content-negative)]"
          aria-label="Remove line"
        >
          <Trash size={13} />
        </button>
        {pendingRemoveId === item.id && (
          <button
            type="button"
            onClick={onConfirmRemove}
            className="text-[9px] text-[var(--content-negative)]"
          >
            Remove?
          </button>
        )}
      </div>
    </div>
  );
}
