import { CheckCircle, Flag } from '@phosphor-icons/react';
import type { PickerCompletedOrder } from '../../hooks/usePickerCompletedOrders';
import { PickQueuePartyBlock } from './PickQueuePartyBlock';
import { TransportChip } from './TransportChip';
import {
  formatPickingCompletedTime,
} from '../../lib/picking/completedPickSummary';
import { formatQueueTimeAgo } from '../../lib/picking/pickQueueDisplay';

interface CompletedPickRowProps {
  order: PickerCompletedOrder;
  onOpen: () => void;
}

export function CompletedPickRow({
  order,
  onOpen,
}: CompletedPickRowProps): React.JSX.Element {
  const summary = order.completedSummary;
  const finishedAt = formatPickingCompletedTime(order.picking_completed_at);
  const ago = formatQueueTimeAgo(order.picking_completed_at);
  const isFlagged = summary.outcome === 'flagged';
  const doneLines = summary.pickedCount + summary.flaggedCount;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`
        w-full rounded-2xl border p-4 text-left transition-all duration-150
        hover:bg-[var(--bg-tertiary)] active:scale-[0.99]
        ${
          isFlagged
            ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]'
            : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
        }
      `}
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              isFlagged
                ? 'bg-[var(--bg-warning)] text-[var(--content-primary)]'
                : 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
            }`}
            aria-hidden="true"
          >
            {isFlagged ? <Flag size={20} weight="fill" /> : <CheckCircle size={20} weight="duotone" />}
          </div>
          <PickQueuePartyBlock order={order} showOrderNumber={false} />
        </div>

        <div className="flex flex-wrap items-center gap-2 pl-[52px]">
          {order.transport_name ? (
            <TransportChip name={order.transport_name} size="sm" />
          ) : null}
          <span className="font-mono text-xs text-[var(--content-quaternary)]">
            {order.order_number}
          </span>
          {(finishedAt || ago) && (
            <span className="text-xs tabular-nums text-[var(--content-tertiary)]">
              {[finishedAt, ago && `${ago}`].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pl-[52px]">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              isFlagged
                ? 'bg-[var(--bg-warning)] text-[var(--content-primary)]'
                : 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
            }`}
          >
            {isFlagged
              ? `${summary.flaggedCount} flagged${summary.flagReasonLabels.length > 0 ? ` · ${summary.flagReasonLabels.slice(0, 2).join(', ')}` : ''}`
              : 'All lines picked'}
          </span>
          <span className="text-xs tabular-nums text-[var(--content-tertiary)]">
            {doneLines}/{summary.totalLines} lines · {summary.piecePicked}/{summary.pieceTarget} pcs
          </span>
        </div>

        {isFlagged && summary.flagReasonLabels.length > 0 && (
          <div className="flex flex-wrap gap-1 pl-[52px]">
            {summary.flagReasonLabels.map((label) => (
              <span
                key={label}
                className="rounded-full border border-[var(--border-warning)] bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--content-warning)]"
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
