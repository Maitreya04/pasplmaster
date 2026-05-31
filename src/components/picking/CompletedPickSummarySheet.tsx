import { useState } from 'react';
import { CaretDown, CaretUp, CheckCircle, Flag, LockSimple } from '@phosphor-icons/react';
import { BottomSheet } from '../shared';
import { TransportChip } from './TransportChip';
import type { PickerCompletedOrder } from '../../hooks/usePickerCompletedOrders';
import {
  formatPickingCompletedTime,
  pickerFlagChipLabel,
} from '../../lib/picking/completedPickSummary';
import { formatLineCountLabel } from '../../lib/picking/pickQueueDisplay';

interface CompletedPickSummarySheetProps {
  order: PickerCompletedOrder | null;
  isOpen: boolean;
  onClose: () => void;
}

export function CompletedPickSummarySheet({
  order,
  isOpen,
  onClose,
}: CompletedPickSummarySheetProps): React.JSX.Element | null {
  const [pickedExpanded, setPickedExpanded] = useState(false);

  if (!order) return null;

  const summary = order.completedSummary;
  const flaggedLines = summary.lines.filter((line) => line.state === 'flagged');
  const pickedLines = summary.lines.filter((line) => line.state === 'picked');
  const hasFlagged = summary.outcome === 'flagged';
  const finishedLabel = formatPickingCompletedTime(order.picking_completed_at);

  const handleClose = () => {
    setPickedExpanded(false);
    onClose();
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose} title="Completed pick">
      <div className="space-y-5">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 space-y-2">
          <p className="text-lg font-bold text-[var(--content-primary)] leading-tight">
            {order.customer_name}
          </p>
          {order.customer_city && (
            <p className="text-sm text-[var(--content-secondary)]">{order.customer_city}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {order.transport_name ? (
              <TransportChip name={order.transport_name} size="md" />
            ) : (
              <span className="text-xs font-semibold text-[var(--content-warning)]">
                No transport set
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-[var(--content-quaternary)]">{order.order_number}</p>
          {finishedLabel && (
            <p className="text-xs text-[var(--content-tertiary)]">Finished {finishedLabel}</p>
          )}
          {order.box_count != null && order.box_count >= 1 && (
            <p className="text-xs tabular-nums text-[var(--content-secondary)]">
              {order.box_count} box{order.box_count === 1 ? '' : 'es'} packed
            </p>
          )}
        </div>

        <div
          className={`rounded-xl p-4 space-y-2 text-sm ${
            hasFlagged
              ? 'bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)]'
              : 'bg-[var(--bg-positive-subtle)] border border-[var(--border-positive)]'
          }`}
        >
          <p className="font-semibold text-[var(--content-primary)]">
            {hasFlagged ? 'Sent to billing with flags' : 'Pick complete'}
          </p>
          <p className="tabular-nums text-[var(--content-secondary)]">
            {formatLineCountLabel(summary.pickedCount, { short: true })} picked
            {summary.flaggedCount > 0 && ` · ${summary.flaggedCount} flagged`}
            {' · '}
            {summary.piecePicked}/{summary.pieceTarget} pcs
          </p>
        </div>

        {flaggedLines.length > 0 && (
          <section className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Flagged lines
            </p>
            <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
              {flaggedLines.map((line, index) => (
                <div
                  key={`${line.itemId ?? line.itemName}-${index}`}
                  className={`flex items-start gap-3 px-4 py-3 ${
                    index < flaggedLines.length - 1 ? 'border-b border-[var(--border-faint)]' : ''
                  }`}
                >
                  <Flag
                    size={18}
                    weight="fill"
                    className="mt-0.5 shrink-0 text-[var(--content-warning)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--content-primary)] leading-snug">
                      {line.itemName}
                    </p>
                    {line.rackNo && (
                      <p className="mt-0.5 text-xs text-[var(--content-tertiary)]">
                        Rack {line.rackNo}
                      </p>
                    )}
                    <p className="mt-1 text-xs font-semibold text-[var(--content-warning)]">
                      {pickerFlagChipLabel(line.flagReason)}
                    </p>
                    {line.flagNotes?.trim() && (
                      <p className="mt-1 text-xs text-[var(--content-secondary)]">
                        {line.flagNotes.trim()}
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 text-xs tabular-nums text-[var(--content-tertiary)]">
                    {line.targetQty} pcs
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {pickedLines.length > 0 && (
          <section className="space-y-2">
            <button
              type="button"
              onClick={() => setPickedExpanded((open) => !open)}
              className="flex w-full items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold text-[var(--content-primary)]">
                Picked lines ({pickedLines.length})
              </span>
              {pickedExpanded ? (
                <CaretUp size={18} className="text-[var(--content-tertiary)]" />
              ) : (
                <CaretDown size={18} className="text-[var(--content-tertiary)]" />
              )}
            </button>
            {pickedExpanded && (
              <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                {pickedLines.map((line, index) => (
                  <div
                    key={`${line.itemId ?? line.itemName}-${index}`}
                    className={`flex items-center gap-3 px-4 py-3 ${
                      index < pickedLines.length - 1 ? 'border-b border-[var(--border-faint)]' : ''
                    }`}
                  >
                    <CheckCircle
                      size={18}
                      weight="fill"
                      className="shrink-0 text-[var(--content-positive)]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--content-primary)]">
                        {line.itemName}
                      </p>
                      {line.rackNo && (
                        <p className="text-xs text-[var(--content-tertiary)]">Rack {line.rackNo}</p>
                      )}
                    </div>
                    <p className="shrink-0 font-mono text-sm tabular-nums text-[var(--content-secondary)]">
                      {line.targetQty} pcs
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3 text-xs text-[var(--content-tertiary)]">
          <LockSimple size={16} weight="duotone" />
          Sent to billing — read only
        </div>
      </div>
    </BottomSheet>
  );
}
