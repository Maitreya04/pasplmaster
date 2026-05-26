import { useEffect, useRef, useState } from 'react';
import { ClipboardText, UserPlus, X } from '@phosphor-icons/react';
import { formatCurrency, formatTimeAgo } from '../../../utils/formatters';
import type { PickLineProgress } from '../../../lib/cartSupply';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { DeskInlinePickerPick } from './DeskInlinePickerPick';
import { DeskOrderQuickActions } from './DeskOrderQuickActions';
import { DeskPickProgress } from './DeskPickProgress';
import {
  DeskStaleCompleteButton,
  DeskStaleCompleteConfirm,
} from './DeskStaleCompleteAction';
import { DeskTooltip } from './DeskTooltip';
import { DESK_STATUS_TOOLTIPS } from './deskStatusHelp';
import { isPickerReassign, needsPickerAssignStrip } from './deskPickerAssign';
import { canDeskStaleComplete } from './deskStaleComplete';
import { deskBtn, deskType } from './deskTypography';

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
  showStaleActions?: boolean;
  showVerifyAction?: boolean;
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
  showStaleActions = false,
  showVerifyAction = false,
  onEdit,
}: DeskOrderRowCardProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null);
  const [completeExpanded, setCompleteExpanded] = useState(false);
  const pill = STATUS_PILL[order.deskStatus];
  const timeSource = order.approved_at ?? order.picked_at ?? order.created_at;
  const showAssignAction = needsPickerAssignStrip(order);
  const reassign = isPickerReassign(order);
  const needsAttention = order.pickingClaimStale || order.deskStatus === 'no_ack';

  useEffect(() => {
    if (!isAssignExpanded || !cardRef.current) return;
    cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [isAssignExpanded]);

  useEffect(() => {
    if (!completeExpanded || !cardRef.current) return;
    cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [completeExpanded]);

  useEffect(() => {
    if (isAssignExpanded) setCompleteExpanded(false);
  }, [isAssignExpanded]);

  return (
    <div
      ref={cardRef}
      className={`
        rounded-lg border bg-[var(--bg-primary)] transition-colors overflow-hidden
        hover:border-[var(--border-opaque)] hover:shadow-sm
        ${isAssignExpanded || completeExpanded ? 'border-[var(--role-primary)]/40 shadow-sm' : 'border-[var(--border-subtle)]'}
        ${needsAttention && !isAssignExpanded && !completeExpanded ? 'border-l-2 border-l-[var(--border-warning)]' : ''}
      `}
    >
      <div className="px-3 pt-2.5 pb-2.5">
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--role-primary)] rounded-md -m-0.5 p-0.5"
            aria-label={`Edit order ${order.order_number} for ${order.customer_name}`}
          >
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className={`${deskType.orderMeta} truncate`}>
                {order.order_number} · {formatTimeAgo(timeSource)}
              </span>
              <DeskTooltip label={DESK_STATUS_TOOLTIPS[order.deskStatus]} side="bottom">
                <span
                  className={`shrink-0 ${deskType.pill} px-2 py-0.5 rounded-full cursor-default ${pill.className}`}
                >
                  {statusLabel(order)}
                </span>
              </DeskTooltip>
            </div>

            <p className={`${deskType.orderTitle} truncate mt-1`}>
              {order.customer_name}
            </p>

            <p className={`${deskType.orderDetail} mt-0.5 truncate`}>
              {order.item_count} items · {formatCurrency(order.total_value)}
            </p>

            {!isAssignExpanded && !completeExpanded && (
              <DeskPickProgress
                order={order}
                progress={pickProgress}
                isLoading={progressLoading}
                compact={showAssignAction}
              />
            )}
          </button>

          <div className="flex flex-col items-end gap-1.5 shrink-0 pt-0.5">
            {showStaleActions &&
              canDeskStaleComplete(order) &&
              !isAssignExpanded &&
              !completeExpanded && (
                <DeskStaleCompleteButton
                  order={order}
                  onClick={() => setCompleteExpanded(true)}
                />
              )}

            {showAssignAction && onAssignToggle && !completeExpanded && (
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
                    ${deskBtn.action} ${deskType.btn}
                    ${isAssignExpanded
                      ? 'text-[var(--content-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)]'
                      : 'text-[var(--content-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-opaque)] hover:text-[var(--content-primary)]'
                    }
                  `}
                >
                  {isAssignExpanded ? (
                    <>
                      <X size={14} weight="bold" />
                      Cancel
                    </>
                  ) : (
                    <>
                      <UserPlus size={14} weight="bold" />
                      {reassign ? 'Re-assign' : 'Assign'}
                    </>
                  )}
                </button>
              </DeskTooltip>
            )}

            {showVerifyAction && !isAssignExpanded && !completeExpanded && (
              <DeskTooltip label="Review bill and line prices" side="bottom">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                  className={`${deskBtn.action} ${deskType.btn} text-[var(--content-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-opaque)] hover:text-[var(--content-primary)]`}
                >
                  <ClipboardText size={14} weight="bold" />
                  Verify
                </button>
              </DeskTooltip>
            )}

            {!isAssignExpanded && !completeExpanded && (
              <DeskOrderQuickActions order={order} pickers={pickers} />
            )}
          </div>
        </div>
      </div>

      {completeExpanded && showStaleActions && (
        <DeskStaleCompleteConfirm
          order={order}
          onCancel={() => setCompleteExpanded(false)}
        />
      )}

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
