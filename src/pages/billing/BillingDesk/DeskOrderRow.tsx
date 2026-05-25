import { formatCurrency, formatTimeAgo } from '../../../utils/formatters';
import type { PickLineProgress } from '../../../lib/cartSupply';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { DeskOrderQuickActions } from './DeskOrderQuickActions';
import { DeskPickProgress } from './DeskPickProgress';
import { DeskTooltip } from './DeskTooltip';
import { DESK_STATUS_TOOLTIPS } from './deskStatusHelp';

const STATUS_PILL: Record<
  DeskOrderRow['deskStatus'],
  { label: string; className: string }
> = {
  picking: {
    label: 'Picking',
    className: 'bg-[var(--role-primary-subtle)] text-[var(--role-content)]',
  },
  checking: {
    label: 'Checking',
    className: 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]',
  },
  no_ack: {
    label: 'No ack',
    className: 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]',
  },
  unassigned: {
    label: 'Unassigned',
    className: 'bg-[var(--bg-tertiary)] text-[var(--content-quaternary)]',
  },
  submitted: {
    label: 'Submitted',
    className: 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]',
  },
  flagged: {
    label: 'Flagged',
    className: 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]',
  },
};

function statusLabel(order: DeskOrderRow): string {
  const base = STATUS_PILL[order.deskStatus];
  if (order.deskStatus === 'picking' && order.picker_name) {
    return order.picker_name.split(/\s+/)[0] ?? order.picker_name;
  }
  return base.label;
}

interface DeskOrderRowCardProps {
  order: DeskOrderRow;
  pickers: PickerLoadInfo[];
  pickerColors: Array<{ bg: string; text: string }>;
  pickProgress?: PickLineProgress;
  progressLoading?: boolean;
  onEdit: () => void;
}

export function DeskOrderRowCard({
  order,
  pickers,
  pickerColors,
  pickProgress,
  progressLoading,
  onEdit,
}: DeskOrderRowCardProps): React.JSX.Element {
  const pill = STATUS_PILL[order.deskStatus];
  const timeSource = order.approved_at ?? order.picked_at ?? order.created_at;
  const staleRing =
    order.pickingClaimStale || order.deskStatus === 'no_ack'
      ? 'ring-1 ring-[var(--border-warning)]'
      : '';

  return (
    <div
      className={`group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-[var(--border-opaque)] hover:bg-[var(--bg-primary)] transition-colors focus-within:border-[var(--border-opaque)] ${staleRing}`}
    >
        <div className="flex items-start gap-1.5 px-2.5 pt-2 pb-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--role-primary)] rounded-md -m-0.5 p-0.5"
            aria-label={`Edit order ${order.order_number} for ${order.customer_name}`}
          >
            <span className="text-[10px] text-[var(--content-quaternary)] tabular-nums">
              {order.order_number} · {formatTimeAgo(timeSource)}
            </span>
            <p className="text-xs font-medium text-[var(--content-primary)] truncate mt-0.5">
              {order.customer_name}
            </p>
            <p className="text-[10px] text-[var(--content-quaternary)] mt-0.5 truncate">
              {order.item_count} items · {formatCurrency(order.total_value)}
              {order.picker_name && order.deskStatus !== 'submitted'
                ? ` · ${order.picker_name}`
                : ''}
            </p>

            <DeskPickProgress
              order={order}
              progress={pickProgress}
              isLoading={progressLoading}
            />
          </button>

          <div className="flex flex-col items-end gap-1 shrink-0 pt-0.5">
            <DeskOrderQuickActions
              order={order}
              pickers={pickers}
              pickerColors={pickerColors}
            />
            <DeskTooltip label={DESK_STATUS_TOOLTIPS[order.deskStatus]} side="bottom">
              <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full cursor-default ${pill.className}`}>
                {statusLabel(order)}
              </span>
            </DeskTooltip>
          </div>
        </div>

        <p
          className="px-2.5 pb-1.5 text-[9px] text-[var(--content-quaternary)] text-right opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
          title="Edit MRP, save bill, notify picker"
        >
          click to edit →
        </p>
      </div>
  );
}
