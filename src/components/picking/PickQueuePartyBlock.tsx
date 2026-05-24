import type { ReactNode } from 'react';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import { StatusBadge } from '../shared/StatusBadge';
import { TransportChip } from './TransportChip';
import { formatBilledTime, formatLineCountLabel } from '../../lib/picking/pickQueueDisplay';

function pickerLineCount(order: { pick_line_count?: number; item_count: number }): number {
  return order.pick_line_count ?? order.item_count;
}

interface PickQueuePartyBlockProps {
  order: OrderWithClaimInfo;
  /** Smaller heading for carousel cards */
  compact?: boolean;
  showOrderNumber?: boolean;
  trailing?: ReactNode;
}

/** Picker-first order identity: party → billed → transport → order # → subtle line count. */
export function PickQueuePartyBlock({
  order,
  compact = false,
  showOrderNumber = true,
  trailing,
}: PickQueuePartyBlockProps): React.JSX.Element {
  const billed = formatBilledTime(order.approved_at, order.created_at);
  const lineCount = pickerLineCount(order);
  const titleClass = compact
    ? 'text-sm font-bold text-[var(--content-primary)] line-clamp-1 leading-tight'
    : 'text-lg font-bold text-[var(--content-primary)] line-clamp-2 leading-snug';

  return (
    <div className="min-w-0 flex-1">
      <p className={titleClass}>{order.customer_name}</p>

      {(order.customer_city || billed) && (
        <p className="mt-0.5 text-xs text-[var(--content-secondary)] truncate">
          {[order.customer_city, billed && `Billed ${billed}`].filter(Boolean).join(' · ')}
        </p>
      )}

      <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'mt-1' : 'mt-2'}`}>
        {order.transport_name ? (
          <TransportChip name={order.transport_name} size={compact ? 'sm' : 'md'} />
        ) : (
          <span className="text-xs font-semibold text-[var(--content-warning)]">
            No transport set
          </span>
        )}
        {order.priority === 'urgent' && (
          <StatusBadge status="urgent" className="!h-5 !px-2 text-[10px]" />
        )}
      </div>

      <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--content-quaternary)] ${compact ? 'mt-1' : 'mt-2'}`}>
        {showOrderNumber && (
          <span className="font-mono">{order.order_number}</span>
        )}
        <span className="tabular-nums">{formatLineCountLabel(lineCount, { short: true })}</span>
        {trailing}
      </div>
    </div>
  );
}
