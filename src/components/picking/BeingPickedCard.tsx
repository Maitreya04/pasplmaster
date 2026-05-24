import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import { StatusBadge } from '../shared/StatusBadge';
import { InitialsAvatar } from '../shared/InitialsAvatar';
import { TransportChip } from './TransportChip';
import {
  formatBilledTime,
  formatLineCountLabel,
  pickProgressFromPreview,
  pickStatusLabel,
} from '../../lib/picking/pickQueueDisplay';

function pickerLineCount(order: { pick_line_count?: number; item_count: number }): number {
  return order.pick_line_count ?? order.item_count;
}

interface BeingPickedCardProps {
  order: OrderWithClaimInfo;
  isMine: boolean;
  onResume?: () => void;
}

export function BeingPickedCard({
  order,
  isMine,
  onResume,
}: BeingPickedCardProps): React.JSX.Element {
  const preview = order.order_items_preview;
  const progress = pickProgressFromPreview(preview);
  const ratio = progress.total > 0 ? progress.ratio : 0;
  const statusLabel = pickStatusLabel(ratio);
  const pickerName = order.claim_info?.claimed_by_name ?? order.picker_name ?? 'Unknown';
  const billed = formatBilledTime(order.approved_at, order.created_at);
  const lineCount = pickerLineCount(order);

  const shellClass = `
    min-w-[68%] max-w-[280px] shrink-0 snap-start rounded-xl p-3 text-left
    ${isMine
      ? 'border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]'
      : 'border border-[var(--border-subtle)] bg-[var(--bg-secondary)] opacity-50 pointer-events-none'
    }
  `;

  const content = (
    <div className="space-y-2">
      {/* Row 1 — party + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[var(--content-primary)] leading-tight">
            {order.customer_name}
          </p>
          {(order.customer_city || billed) && (
            <p className="mt-0.5 truncate text-xs text-[var(--content-tertiary)]">
              {[order.customer_city, billed && `Billed ${billed}`].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <span
          className={`
            shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide
            ${
              statusLabel === 'Almost done'
                ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
                : 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]'
            }
          `}
        >
          {statusLabel}
        </span>
      </div>

      {/* Row 2 — logistics */}
      <div className="flex flex-wrap items-center gap-1.5">
        {order.transport_name ? (
          <TransportChip name={order.transport_name} size="sm" />
        ) : (
          <span className="text-[10px] font-semibold text-[var(--content-warning)]">No transport</span>
        )}
        {order.priority === 'urgent' && (
          <StatusBadge status="urgent" className="!h-5 !px-2 text-[10px]" />
        )}
        <span className="text-[10px] tabular-nums text-[var(--content-quaternary)]">
          {formatLineCountLabel(lineCount, { short: true })}
        </span>
      </div>

      {/* Row 3 — progress + picker */}
      <div className="h-0.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
        <div
          className="h-full bg-[var(--content-secondary)] transition-all duration-300"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <InitialsAvatar name={pickerName} size="sm" className="!h-6 !w-6 !text-[9px]" />
        <span className="min-w-0 truncate text-xs text-[var(--content-secondary)]">{pickerName}</span>
      </div>
    </div>
  );

  if (isMine) {
    return (
      <button
        type="button"
        onClick={onResume}
        className={`${shellClass} transition-transform duration-150 active:scale-[0.99]`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={shellClass} aria-disabled="true">
      {content}
    </div>
  );
}
