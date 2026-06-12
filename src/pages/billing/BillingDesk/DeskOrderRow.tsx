import { useEffect, useRef, useState } from 'react';
import { ClipboardText, UserPlus, X } from '@phosphor-icons/react';
import { formatTimeAgo } from '../../../utils/formatters';
import type { PickLineProgress } from '../../../lib/cartSupply';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { BillingFigure } from '../../../components/billing/shared/BillingFigure';
import { AssignPickerStage } from '../../../components/billing/stages/AssignPickerStage';
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
import { BillingClaimBadge } from '../../../components/billing/shared/BillingClaimBadge';
import { showPostPickBillingClaimBadge } from '../../../lib/billing/postPickBillingClaim';

const STATUS_PILL: Record<
  DeskOrderRow['deskStatus'],
  { label: string; className: string }
> = {
  picking: {
    label: 'Picking',
    className: 'text-[var(--role-content)] bg-[var(--role-primary-subtle)]',
  },
  checking: {
    label: 'Verify bill',
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

function statusLabel(order: DeskOrderRow, completedView: boolean): string {
  if (completedView) return 'Completed';
  const base = STATUS_PILL[order.deskStatus];
  if (
    (order.deskStatus === 'picking' || order.deskStatus === 'no_ack') &&
    order.picker_name
  ) {
    return order.picker_name.split(/\s+/)[0] ?? order.picker_name;
  }
  return base.label;
}

function isRecentlyCompleted(order: DeskOrderRow): boolean {
  if (!order.completed_at) return false;
  const completedMs = new Date(order.completed_at).getTime();
  if (!Number.isFinite(completedMs)) return false;
  return Date.now() - completedMs < 30 * 60 * 1000;
}

interface DeskOrderRowCardProps {
  order: DeskOrderRow;
  pickers: PickerLoadInfo[];
  pickerColors: Array<{ bg: string; text: string }>;
  pickProgress?: PickLineProgress;
  progressLoading?: boolean;
  isSelected?: boolean;
  isAssignExpanded?: boolean;
  onAssignToggle?: () => void;
  onAssignClose?: () => void;
  showStaleActions?: boolean;
  showVerifyAction?: boolean;
  showCompletedFreshness?: boolean;
  onEdit: () => void;
}

export function DeskOrderRowCard({
  order,
  pickers,
  pickerColors,
  pickProgress,
  progressLoading,
  isSelected = false,
  isAssignExpanded = false,
  onAssignToggle,
  onAssignClose,
  showStaleActions = false,
  showVerifyAction = false,
  showCompletedFreshness = false,
  onEdit,
}: DeskOrderRowCardProps): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null);
  const [completeExpanded, setCompleteExpanded] = useState(false);
  const pill = STATUS_PILL[order.deskStatus];
  const timeSource = order.approved_at ?? order.picked_at ?? order.created_at;
  const showAssignAction = needsPickerAssignStrip(order);
  const reassign = isPickerReassign(order);
  const statusPillClass = showCompletedFreshness
    ? 'text-[var(--content-positive)] bg-[var(--bg-positive-subtle)]'
    : pill.className;
  const freshCompleted = showCompletedFreshness && isRecentlyCompleted(order);
  const statusTooltip = showCompletedFreshness
    ? 'Bill saved — billing handoff complete.'
    : DESK_STATUS_TOOLTIPS[order.deskStatus];

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
        ${
          isSelected
            ? order.deskStatus === 'checking'
              ? 'border-[var(--border-positive)] ring-2 ring-[var(--bg-positive)]/30 shadow-sm'
              : 'border-[var(--role-primary)] ring-2 ring-[var(--role-primary)]/25 shadow-sm'
            : isAssignExpanded || completeExpanded
              ? 'border-[var(--role-primary)]/40 shadow-sm'
              : 'border-[var(--border-subtle)]'
        }
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
              <DeskTooltip label={statusTooltip} side="bottom">
                <span
                  className={`shrink-0 ${deskType.pill} px-2 py-0.5 rounded-full cursor-default ${statusPillClass}`}
                >
                  {statusLabel(order, showCompletedFreshness)}
                </span>
              </DeskTooltip>
              {freshCompleted && (
                <span className={`${deskType.pill} shrink-0 px-2 py-0.5 rounded-full bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]`}>
                  Just completed
                </span>
              )}
            </div>

            <p className={`${deskType.orderTitle} line-clamp-2 mt-1`} title={order.customer_name}>
              {order.customer_name}
            </p>

            <p className={`${deskType.orderDetail} mt-0.5 flex flex-wrap items-baseline gap-x-1`}>
              <span>
                {order.item_count} items ·
              </span>
              <BillingFigure value={order.total_value} kind="currency" size="xs" />
            </p>

            {showPostPickBillingClaimBadge(order) ? (
              <div className="mt-1.5">
                <BillingClaimBadge order={order} postPick />
              </div>
            ) : null}

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
                  className={`${deskBtn.billingSecondary} ${deskType.btn}`}
                >
                  <ClipboardText size={16} weight="regular" />
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
        <AssignPickerStage
          order={order}
          pickers={pickers}
          pickerColors={pickerColors}
          onClose={onAssignToggle}
          onAssigned={onAssignClose ?? onAssignToggle}
          variant="inline"
        />
      )}
    </div>
  );
}
