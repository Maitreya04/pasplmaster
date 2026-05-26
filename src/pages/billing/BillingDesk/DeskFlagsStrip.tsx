import { CheckCircle, Flag, Package, PencilSimple, Warning } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { canQuickResolveDeskFlag, resolveDeskPickerFlags } from '../../../lib/billing/deskResolveFlag';
import { formatTimeAgo } from '../../../utils/formatters';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { deskType } from './deskTypography';

function flagTypeLabel(
  order: DeskOrderRow,
): { label: string; tone: 'red' | 'amber' | 'blue' } {
  const reason = order.pickerFlags[0]?.flagReason ?? order.notes ?? '';
  const lower = reason.toLowerCase();
  if (lower.includes('stock') || lower.includes('out of stock')) {
    return { label: 'Out of stock', tone: 'red' };
  }
  if (lower.includes('price') || lower.includes('mrp')) {
    return { label: 'Price query', tone: 'blue' };
  }
  if (order.pickerFlags[0]?.flagReason) {
    return { label: order.pickerFlags[0].flagReason, tone: 'amber' };
  }
  if (order.notes?.toLowerCase().includes('price')) {
    return { label: 'Price query', tone: 'blue' };
  }
  return { label: 'Qty mismatch', tone: 'amber' };
}

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

interface DeskFlagsStripProps {
  orders: DeskOrderRow[];
  onReview: (order: DeskOrderRow) => void;
}

export function DeskFlagsStrip({ orders, onReview }: DeskFlagsStripProps): React.JSX.Element | null {
  const { userName } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const quickResolveMutation = useMutation({
    mutationFn: async (order: DeskOrderRow) => {
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

  if (orders.length === 0) return null;

  return (
    <div className="sticky top-0 z-[1] bg-[var(--bg-warning-subtle)] border-b-[1.5px] border-[var(--border-warning)]">
      <div className="flex items-center justify-between px-3.5 py-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Flag size={12} weight="fill" className="text-[var(--content-warning-on-light)] shrink-0" />
          <span className={`${deskType.sectionLabel} text-[var(--content-warning-on-light)] truncate`}>
            Needs action
          </span>
          <span className={`${deskType.pill} px-2 py-0.5 rounded-full bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)] border border-[var(--border-warning)] shrink-0`}>
            {orders.length}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 px-3.5 pb-2.5 max-h-[min(40vh,280px)] overflow-y-auto overscroll-y-contain">
        {orders.map((order) => {
          const type = flagTypeLabel(order);
          const isCritical = type.tone === 'red';
          const stillPicking = order.workflow_status === 'picking';
          const canQuickResolve = canQuickResolveDeskFlag(order);
          const isResolving =
            quickResolveMutation.isPending &&
            quickResolveMutation.variables?.id === order.id;

          return (
            <div
              key={order.id}
              className="rounded-lg border border-[var(--border-warning)] bg-[var(--bg-secondary)] p-2.5 flex flex-col gap-2"
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
                  <p className={`${deskType.orderDetail} text-[var(--content-warning-on-light)] mt-0.5 line-clamp-2`}>
                    {flagDescription(order)}
                  </p>
                  {order.picker_name && (
                    <p className={`${deskType.orderDetail} text-[var(--content-quaternary)] mt-0.5`}>
                      Flagged by {order.picker_name}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 pl-[26px]">
                {canQuickResolve && (
                  <button
                    type="button"
                    disabled={isResolving}
                    onClick={() => quickResolveMutation.mutate(order)}
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
        })}
      </div>
    </div>
  );
}