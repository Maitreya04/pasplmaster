import { useEffect, useRef } from 'react';
import { UserPlus, X } from '@phosphor-icons/react';
import { formatCurrency, formatTimeAgo } from '../../../utils/formatters';
import type { PickLineProgress } from '../../../lib/cartSupply';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { DeskInlinePickerPick } from './DeskInlinePickerPick';
import { DeskOrderQuickActions } from './DeskOrderQuickActions';
import { DeskPickProgress } from './DeskPickProgress';
import { DeskTooltip } from './DeskTooltip';
import { DESK_STATUS_TOOLTIPS } from './deskStatusHelp';
import { isPickerReassign, needsPickerAssignStrip } from './deskPickerAssign';

const STATUS_PILL: Record<
  DeskOrderRow['deskStatus'],
  { label: string; className: string }
> = {
  picking: {
    label: 'Picking',
    className: 'text-[var(--role-content)] bg-[var(--role-primary-subtle)]',
  },
  checking: {
    label: 'Done',
    className: 'text-[var(--content-positive)] bg-[var(--bg-positive-subtle)]',
  },
  no_ack: {
    label: 'Waiting',
    className: 'text-[var(--content-warning-on-light)] bg-[var(--bg-warning-subtle)]',
  },
  unassigned: {
    label: 'Unassigned',
    className: 'text-[var(--content-quaternary)] bg-[var(--bg-tertiary)]',
  },
  submitted: {
    label: 'Submitted',
    className: 'text-[var(--content-accent)] bg-[var(--bg-accent-subtle)]',
  },
  flagged: {
    label: 'Flagged',
    className: 'text-[var(--content-warning-on-light)] bg-[var(--bg-warning-subtle)]',
  },
};

function statusLabel(order: DeskOrderRow): string {
  const base = STATUS_PILL[order.deskStatus];
  if (
    (order.deskStatus === 'picking' || order.deskStatus === 'no_ack') &&
    order.picker_name
  ) {
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
  isAssignExpanded?: boolean;
  onAssignToggle?: () => void;
  onEdit: () => void;
}

export function DeskOrderRowCard({
  order,
  pickers,
  pickerColors,
  pickProgress,
  progressLoading,
  isAssignExpanded = false,
  onAssignToggle,
  onEdit,
}: DeskOrderRowCardProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null);
  const pill = STATUS_PILL[order.deskStatus];
  const timeSource = order.approved_at ?? order.picked_at ?? order.created_at;
  const showAssignAction = needsPickerAssignStrip(order);
  const reassign = isPickerReassign(order);
  const needsAttention = order.pickingClaimStale || order.deskStatus === 'no_ack';

  useEffect(() => {
    if (!isAssignExpanded || !cardRef.current) return;
    cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isAssignExpanded]);

  return (
    <div
      ref={cardRef}
      className={`
        rounded-lg border bg-[var(--bg-primary)] transition-colors overflow-hidden
        hover:border-[var(--border-opaque)] hover:shadow-sm
        ${isAssignExpanded ? 'border-[var(--role-primary)]/40 shadow-sm' : 'border-[var(--border-subtle)]'}
        ${needsAttention && !isAssignExpanded ? 'border-l-2 border-l-[var(--border-warning)]' : ''}
      `}
    >
      <div className="px-2.5 pt-2 pb-2">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--role-primary)] rounded-md -m-0.5 p-0.5"
            aria-label={`Edit order ${order.order_number} for ${order.customer_name}`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] text-[var(--content-quaternary)] tabular-nums truncate">
                {order.order_number} · {formatTimeAgo(timeSource)}
              </span>
              <DeskTooltip label={DESK_STATUS_TOOLTIPS[order.deskStatus]} side="bottom">
                <span
                  className={`shrink-0 text-[9px] font-medium px-1.5 py-0.5 rounded-full cursor-default ${pill.className}`}
                >
                  {statusLabel(order)}
                </span>
              </DeskTooltip>
            </div>

            <p className="text-xs font-medium text-[var(--content-primary)] truncate mt-1">
              {order.customer_name}
            </p>

            <p className="text-[10px] text-[var(--content-quaternary)] mt-0.5 truncate">
              {order.item_count} items · {formatCurrency(order.total_value)}
            </p>

            {!isAssignExpanded && (
              <DeskPickProgress
                order={order}
                progress={pickProgress}
                isLoading={progressLoading}
                compact={showAssignAction}
              />
            )}
          </button>

          <div className="flex flex-col items-end gap-1 shrink-0 pt-0.5">
            {showAssignAction && onAssignToggle && (
              <DeskTooltip
                label={isAssignExpanded ? 'Cancel' : reassign ? 'Re-assign picker' : 'Assign picker'}
                side="bottom"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAssignToggle();
                  }}
                  className={`
                    inline-flex items-center gap-1 h-7 px-2 rounded-md text-[10px] font-medium transition-colors
                    ${isAssignExpanded
                      ? 'text-[var(--content-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)]'
                      : 'text-[var(--content-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-opaque)] hover:text-[var(--content-primary)]'
                    }
                  `}
                >
                  {isAssignExpanded ? (
                    <>
                      <X size={12} weight="bold" />
                      Cancel
                    </>
                  ) : (
                    <>
                      <UserPlus size={12} weight="bold" />
                      {reassign ? 'Re-assign' : 'Assign'}
                    </>
                  )}
                </button>
              </DeskTooltip>
            )}

            {!isAssignExpanded && (
              <DeskOrderQuickActions order={order} pickers={pickers} />
            )}
          </div>
        </div>
      </div>

      {isAssignExpanded && showAssignAction && onAssignToggle && (
        <DeskInlinePickerPick
          order={order}
          pickers={pickers}
          pickerColors={pickerColors}
          onDone={onAssignToggle}
        />
      )}
    </div>
  );
}
