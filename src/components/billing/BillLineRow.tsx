import { Check, Trash } from '@phosphor-icons/react';
import { billLineChangeSegments } from '../../lib/billing/billLineChangeStrip';
import { billLineIdentity } from '../../lib/billing/billLineIdentity';
import {
  deskLineFlagAccent,
  deskLineFlagKind,
} from '../../lib/billing/deskLineFlagKind';
import { resolvedLabelPriceForBilling } from '../../lib/billing/labelMrpFlag';
import {
  BILLING_ACCEPT_LABEL,
  BILLING_KEEP_QUOTED,
  formatRoundedRs,
} from '../../lib/billing/mrpWorkflowCopy';
import { orderItemConfirmedMrp } from '../../lib/billing/orderItemSplitGroups';
import type { OrderItem } from '../../types';
import type { OverlayLineEdit } from '../../pages/billing/BillingDesk/types';

const ROW_GRID =
  'grid grid-cols-[28px_minmax(52px,72px)_minmax(0,1fr)_32px_64px_minmax(88px,max-content)] gap-x-1.5 items-center';

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

export function BillLineTableHeader({
  compact,
}: {
  compact?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`${ROW_GRID} bg-[var(--bg-tertiary)] px-2.5 py-1.5 text-[9px] font-semibold uppercase text-[var(--content-quaternary)] ${
        compact ? 'text-[8px]' : ''
      }`}
    >
      <span className="text-center">#</span>
      <span>Code</span>
      <span>Item</span>
      <span className="text-center">Qty</span>
      <span>{compact ? 'MRP' : 'Bill rate'}</span>
      <span className="text-right">Action</span>
    </div>
  );
}

export interface BillLineRowProps {
  lineNo: number;
  item: OrderItem;
  edit: OverlayLineEdit;
  isSplitChild?: boolean;
  pendingRemoveId: number | null;
  showUndoRemove?: boolean;
  onAcceptPrice: () => void;
  onKeepQuoted: () => void;
  onRemove: () => void;
  onUndoRemove: () => void;
  onPriceChange: (price: number) => void;
  onRequestRemove: () => void;
  onConfirmRemove: () => void;
}

export function BillLineRow({
  lineNo,
  item,
  edit,
  isSplitChild,
  pendingRemoveId,
  showUndoRemove,
  onAcceptPrice,
  onKeepQuoted,
  onRemove,
  onUndoRemove,
  onPriceChange,
  onRequestRemove,
  onConfirmRemove,
}: BillLineRowProps): React.JSX.Element | null {
  if (edit.removed && item.state !== 'flagged') return null;

  const identity = billLineIdentity(item);
  const changeSegments = billLineChangeSegments(item, edit);
  const isFlagged = item.state === 'flagged';
  const kind = deskLineFlagKind(item.flag_reason);
  const accent = deskLineFlagAccent(item.flag_reason);
  const isResolved = edit.resolution != null;
  const isRemoved = edit.resolution === 'removed' || edit.removed;
  const labelMrp = orderItemConfirmedMrp(item);
  const quoted = item.price_quoted ?? item.price_system ?? 0;
  const labelPrice = resolvedLabelPriceForBilling(item, labelMrp);
  const showPriceAccept = !isResolved && isFlagged && kind === 'price' && labelPrice != null;
  const showOosKeep = !isResolved && isFlagged && kind === 'oos';
  const showNormalRemove = !isFlagged && !isRemoved;

  const removeTitle =
    kind === 'oos'
      ? 'Remove from order · adds to pending'
      : 'Remove line';

  let rowClass = 'border-t border-[var(--border-faint)] border-l-2 px-2.5 py-2';
  if (isFlagged) {
    if (isResolved && !isRemoved) {
      rowClass += ' border-l-[var(--border-positive)] bg-[var(--bg-positive-subtle)]/25';
    } else if (isRemoved) {
      rowClass += ' border-l-[var(--border-subtle)] bg-[var(--bg-tertiary)]/70 opacity-80';
    } else {
      rowClass += ` ${accentBorderClass(accent)}`;
    }
  } else if (isSplitChild) {
    rowClass += ' bg-[var(--bg-secondary)]/60';
  }

  return (
    <div className={`${ROW_GRID} ${rowClass}`}>
      <span className="text-[10px] tabular-nums text-center text-[var(--content-quaternary)]">
        {lineNo}
      </span>

      <div className="min-w-0">
        {identity.pickCode ? (
          <p className="font-mono text-[10px] text-[var(--content-secondary)] truncate">
            {identity.pickCode}
          </p>
        ) : (
          <span className="text-[10px] text-[var(--content-quaternary)]">—</span>
        )}
        {identity.altCode ? (
          <p className="font-mono text-[9px] text-[var(--content-quaternary)] truncate mt-0.5">
            {identity.altCode}
          </p>
        ) : null}
      </div>

      <div className="min-w-0">
        <p
          className={`text-xs truncate ${
            isRemoved
              ? 'text-[var(--content-quaternary)] line-through'
              : 'text-[var(--content-primary)]'
          }`}
          title={identity.description}
        >
          {isSplitChild ? '↳ ' : ''}
          {identity.description}
        </p>
        {changeSegments.length > 0 ? (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {changeSegments.map((seg, i) => {
              if (seg.kind === 'flag' || seg.kind === 'resolved') {
                return (
                  <span
                    key={`${seg.label}-${i}`}
                    className={`shrink-0 text-[8px] font-semibold px-1 py-px rounded-full border whitespace-nowrap ${
                      seg.kind === 'resolved'
                        ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border-[var(--border-positive)]'
                        : accentChipClass(accent)
                    }`}
                  >
                    {seg.label}
                  </span>
                );
              }
              return (
                <span
                  key={`${seg.text}-${i}`}
                  className="text-[9px] text-[var(--content-quaternary)] truncate max-w-full"
                >
                  {seg.text}
                </span>
              );
            })}
          </div>
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
        {showPriceAccept ? (
          <>
            <button
              type="button"
              onClick={onAcceptPrice}
              title={`${BILLING_ACCEPT_LABEL} ${formatRoundedRs(labelPrice!)}`}
              className="h-7 px-1.5 rounded-md text-[9px] font-semibold leading-none bg-[var(--bg-positive)] text-white hover:opacity-95 whitespace-nowrap"
            >
              {BILLING_ACCEPT_LABEL}
            </button>
            <button
              type="button"
              onClick={onKeepQuoted}
              title={`${BILLING_KEEP_QUOTED} ${formatRoundedRs(quoted)}`}
              className="h-7 px-1.5 rounded-md text-[9px] font-medium leading-none border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] whitespace-nowrap"
            >
              {BILLING_KEEP_QUOTED}
            </button>
          </>
        ) : null}

        {showOosKeep ? (
          <>
            <button
              type="button"
              onClick={onKeepQuoted}
              title={`Keep in order at ${formatRoundedRs(edit.priceQuoted)}`}
              className="h-7 px-1.5 rounded-md text-[9px] font-semibold leading-none bg-[var(--bg-positive)] text-white hover:opacity-95 whitespace-nowrap"
            >
              {BILLING_KEEP_QUOTED}
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

        {showNormalRemove ? (
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
        ) : null}
      </div>
    </div>
  );
}
