import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Package } from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useSalesPendingRecovery } from '../../hooks/useSalesPendingRecovery';
import { Card, EmptyState, Skeleton } from '../../components/shared';
import { formatTimeAgo } from '../../utils/formatters';
import {
  isPendingRecoveryActionable,
  pendingRecoveryBadgeClasses,
  pendingRecoveryHelpText,
  pendingRecoveryLabel,
} from '../../lib/pendingRecovery';
import type { PendingItem } from '../../types';

type PendingRecoveryAction = 'send_to_billing' | 'keep_pending' | 'customer_declined';

function RecoveryBadge({ status }: { status: PendingItem['recovery_status'] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${pendingRecoveryBadgeClasses(status)}`}
    >
      {pendingRecoveryLabel(status)}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const className =
    variant === 'primary'
      ? 'border-transparent bg-[var(--role-primary)] text-[var(--role-content)]'
      : variant === 'danger'
        ? 'border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]'
        : 'border-[var(--border-opaque)] bg-[var(--bg-primary)] text-[var(--content-primary)]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export default function PendingRecoveryPage(): React.JSX.Element | null {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userId, userName } = useAuth();
  const { data, isLoading, error } = useSalesPendingRecovery(userName);

  const actionMutation = useMutation({
    mutationFn: async ({
      pendingItemId,
      action,
    }: {
      pendingItemId: number;
      action: PendingRecoveryAction;
    }) => {
      const { data: result, error } = await supabase.rpc('process_pending_recovery_action', {
        p_pending_item_id: pendingItemId,
        p_action: action,
        p_actor_user_id: userId,
        p_actor_name: userName,
      });

      if (error) throw error;
      return result as { billing_notified?: number } | null;
    },
    onSuccess: (_result, vars) => {
      queryClient.invalidateQueries({ queryKey: ['sales-pending-recovery'] });
      queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      queryClient.invalidateQueries({ queryKey: ['user-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });

      if (vars.action === 'send_to_billing') {
        toast.success('Sent back to billing for review');
        return;
      }
      if (vars.action === 'keep_pending') {
        toast.info('Left pending until the next stock/customer check');
        return;
      }
      toast.info('Removed this pending line from follow-up');
    },
    onError: () => {
      toast.error('Failed to update pending follow-up');
    },
  });

  const actionable = useMemo(
    () => (data ?? []).filter((item) => isPendingRecoveryActionable(item.recovery_status)),
    [data],
  );
  const waiting = useMemo(
    () => (data ?? []).filter((item) => item.recovery_status === 'waiting_stock'),
    [data],
  );

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-5xl p-4 pb-8">
        <h1 className="text-2xl font-bold text-[var(--content-primary)]">Pending Follow-up</h1>
        <p className="mt-1 text-sm text-[var(--content-secondary)]">
          Sales recovery queue for pending lines that need customer follow-up before billing.
        </p>

        <div className="mt-4 flex flex-wrap gap-3 text-sm text-[var(--content-secondary)]">
          <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-3 py-2">
            <span className="font-mono font-semibold">{actionable.length}</span>
            <span>action needed</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-3 py-2">
            <span className="font-mono font-semibold">{waiting.length}</span>
            <span>waiting stock</span>
          </div>
        </div>

        <div className="mt-6">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton variant="card" count={4} />
            </div>
          ) : error ? (
            <p className="text-[var(--content-negative)]">Failed to load pending follow-up queue</p>
          ) : !data || data.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Nothing waiting on sales"
              description="When pending lines come fully back in stock, they will show up here for customer follow-up."
            />
          ) : (
            <div className="space-y-8">
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-[var(--content-primary)]">Action needed</h2>
                    <p className="text-sm text-[var(--content-secondary)]">
                      Back-in-stock and recheck lines that need a sales decision.
                    </p>
                  </div>
                </div>

                {actionable.length === 0 ? (
                  <Card>
                    <p className="text-sm text-[var(--content-secondary)]">
                      No back-in-stock lines need a decision right now.
                    </p>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {actionable.map((item) => {
                      const isBusy = actionMutation.isPending && actionMutation.variables?.pendingItemId === item.id;

                      return (
                        <Card key={item.id} className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-bold text-[var(--content-primary)]">{item.customer_name}</p>
                              <p className="text-xs text-[var(--content-tertiary)]">
                                Order <span className="font-mono">{item.order_number}</span>
                              </p>
                            </div>
                            <RecoveryBadge status={item.recovery_status} />
                          </div>

                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-[var(--content-primary)]">{item.item_name}</p>
                            <p className="text-sm text-[var(--content-secondary)]">
                              Pending qty <span className="font-mono font-semibold">{item.qty_pending}</span>
                            </p>
                            <p className="text-xs text-[var(--content-tertiary)]">
                              {pendingRecoveryHelpText(item.recovery_status)}
                            </p>
                            {item.back_in_stock_at && (
                              <p className="text-xs text-[var(--content-tertiary)]">
                                First surfaced {formatTimeAgo(item.back_in_stock_at)}
                              </p>
                            )}
                            {item.note && (
                              <p className="text-xs text-[var(--content-tertiary)]">Note: {item.note}</p>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <ActionButton
                              disabled={isBusy}
                              onClick={() =>
                                actionMutation.mutate({
                                  pendingItemId: item.id,
                                  action: 'send_to_billing',
                                })
                              }
                            >
                              Customer confirmed → send to billing
                            </ActionButton>
                            <ActionButton
                              variant="secondary"
                              disabled={isBusy}
                              onClick={() =>
                                actionMutation.mutate({
                                  pendingItemId: item.id,
                                  action: 'keep_pending',
                                })
                              }
                            >
                              Keep pending
                            </ActionButton>
                            <ActionButton
                              variant="danger"
                              disabled={isBusy}
                              onClick={() =>
                                actionMutation.mutate({
                                  pendingItemId: item.id,
                                  action: 'customer_declined',
                                })
                              }
                            >
                              Customer no longer wants it
                            </ActionButton>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </section>

              <section>
                <div className="mb-3">
                  <h2 className="text-lg font-semibold text-[var(--content-primary)]">Waiting stock</h2>
                  <p className="text-sm text-[var(--content-secondary)]">
                    Open pending lines that are still waiting for enough stock.
                  </p>
                </div>

                {waiting.length === 0 ? (
                  <Card>
                    <p className="text-sm text-[var(--content-secondary)]">
                      Everything open is already in an action-needed state.
                    </p>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {waiting.map((item) => (
                      <Card key={item.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-[var(--content-primary)]">{item.customer_name}</p>
                            <p className="text-xs text-[var(--content-tertiary)]">
                              Order <span className="font-mono">{item.order_number}</span>
                            </p>
                          </div>
                          <RecoveryBadge status={item.recovery_status} />
                        </div>
                        <div className="mt-3">
                          <p className="text-sm font-semibold text-[var(--content-primary)]">{item.item_name}</p>
                          <p className="text-sm text-[var(--content-secondary)]">
                            Pending qty <span className="font-mono font-semibold">{item.qty_pending}</span>
                          </p>
                          <p className="mt-1 text-xs text-[var(--content-tertiary)]">
                            {pendingRecoveryHelpText(item.recovery_status)}
                          </p>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
