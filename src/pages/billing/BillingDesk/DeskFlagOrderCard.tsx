import { CheckCircle, Package, PencilSimple, Warning } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { canQuickResolveDeskFlag, resolveDeskPickerFlags } from '../../../lib/billing/deskResolveFlag';
import { deskOrderFlagTypeLabel } from '../../../lib/billing/deskLineFlagKind';
import type { PickLineProgress } from '../../../lib/cartSupply';
import { formatCurrency, formatTimeAgo } from '../../../utils/formatters';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { DeskPickProgress } from './DeskPickProgress';
import { deskType } from './deskTypography';
import { BillingClaimBadge } from '../../../components/billing/shared/BillingClaimBadge';
import { showPostPickBillingClaimBadge } from '../../../lib/billing/postPickBillingClaim';

function flagDescription(order: DeskOrderRow): string {
  const first = order.pickerFlags[0];
  if (first) {
    const extra =
      order.pickerFlags.length > 1 ? ` (+${order.pickerFlags.length - 1} more)` : '';
    return `${first.itemName} — ${first.flagReason ?? 'needs review'}${extra}`;
  }
  if (order.notes?.trim()) return order.notes.trim();
  return 'Picker raised an issue during pick';
}

function flagTimeSource(order: DeskOrderRow): string {
  return order.picked_at ?? order.approved_at ?? order.created_at;
}

export interface DeskFlagOrderCardProps {
  order: DeskOrderRow;
  onReview: (order: DeskOrderRow) => void;
  isSelected?: boolean;
  pickProgress?: PickLineProgress;
  progressLoading?: boolean;
  showPickProgress?: boolean;
}

export function DeskFlagOrderCard({
  order,
  onReview,
  isSelected = false,
  pickProgress,
  progressLoading = false,
  showPickProgress = false,
}: DeskFlagOrderCardProps): React.JSX.Element {
  const { userName } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const quickResolveMutation = useMutation({
    mutationFn: async () => {
      await resolveDeskPickerFlags({
        order,
        reviewerName: userName ?? 'Billing',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['desk-picker-flags'] });
      toast.success('Flag acknowledged — picker can continue');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Could not resolve flag');
    },
  });

  const flagReasons = order.pickerFlags.map((f) => f.flagReason);
  const type = deskOrderFlagTypeLabel(flagReasons);
  const isCritical = type.tone === 'red';
  const stillPicking = order.workflow_status === 'picking';
  const canQuickResolve = canQuickResolveDeskFlag(order);
  const isResolving = quickResolveMutation.isPending;

  return (
    <div
      className={`rounded-lg border bg-[var(--bg-secondary)] p-2.5 flex flex-col gap-2 transition-colors ${
        isSelected
          ? 'border-[var(--role-primary)] ring-2 ring-[var(--role-primary)]/25 shadow-sm'
          : 'border-[var(--border-warning)]'
      }`}
    >
      <div className="flex items-start gap-2 min-w-0">
        <span
          className={`mt-1.5 w-[7px] h-[7px] rounded-full shrink-0 animate-pulse ${
            isCritical ? 'bg-[var(--bg-negative)]' : 'bg-[var(--content-warning-on-light)]'
          }`}
        />
        {isCritical ? (
          <Package size={15} className="text-[var(--content-warning-on-light)] shrink-0 mt-0.5" />
        ) : (
          <Warning size={15} className="text-[var(--content-warning-on-light)] shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`${deskType.orderTitle} text-[var(--content-warning)] truncate`}>
              {order.customer_name}
            </p>
            <span
              className={`shrink-0 ${deskType.pill} px-2 py-0.5 rounded-full ${
                type.tone === 'red'
                  ? 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]'
                  : type.tone === 'blue'
                    ? 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                    : 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
              }`}
            >
              {type.label}
            </span>
          </div>
          <p className={`${deskType.orderMeta} text-[var(--content-warning-on-light)] mt-0.5`}>
            {order.order_number} · {formatTimeAgo(flagTimeSource(order))}
            {stillPicking && (
              <span className="ml-1 font-medium text-[var(--content-warning)]">
                · still picking
              </span>
            )}
          </p>
          {showPostPickBillingClaimBadge(order) ? (
            <div className="mt-1.5">
              <BillingClaimBadge order={order} postPick />
            </div>
          ) : null}
          <p className={`${deskType.orderDetail} text-[var(--content-warning-on-light)] mt-0.5 line-clamp-2`}>
            {flagDescription(order)}
          </p>
          <p className={`${deskType.orderDetail} text-[var(--content-warning-on-light)] mt-0.5`}>
            {order.item_count} items · {formatCurrency(order.total_value)}
          </p>
          {order.picker_name && (
            <p className={`${deskType.orderDetail} text-[var(--content-quaternary)] mt-0.5`}>
              Flagged by {order.picker_name}
            </p>
          )}
          {showPickProgress ? (
            <div className="mt-1">
              <DeskPickProgress
                order={order}
                progress={pickProgress}
                isLoading={progressLoading}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-2 pl-[26px]">
        {canQuickResolve && (
          <button
            type="button"
            disabled={isResolving}
            onClick={() => quickResolveMutation.mutate()}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg ${deskType.btn} font-semibold bg-[var(--bg-positive)] text-white hover:opacity-95 disabled:opacity-50 transition-opacity`}
          >
            <CheckCircle size={14} weight="bold" />
            {isResolving ? 'Saving…' : 'Acknowledge'}
          </button>
        )}
        <button
          type="button"
          onClick={() => onReview(order)}
          className={`${canQuickResolve ? 'flex-1' : 'w-full'} inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg ${deskType.btn} font-medium border border-[var(--border-warning)] bg-[var(--bg-secondary)] text-[var(--content-warning-on-light)] hover:bg-[var(--bg-warning-subtle)] transition-colors`}
        >
          <PencilSimple size={14} weight="bold" />
          {canQuickResolve ? 'Review lines' : 'Review & resolve'}
        </button>
      </div>
    </div>
  );
}
