import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Prohibit } from '@phosphor-icons/react';
import { useOrders } from '../../hooks/useOrders';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { supabase } from '../../lib/supabase/client';
import {
  formatInternalNotificationError,
  sendInternalNotification,
} from '../../lib/pickerPush';
import {
  canRevive,
  accountHoldDisplayNote,
  isAccountHold,
} from '../../lib/billing/rejectionKind';
import { invalidateLocationwiseStockQueries } from '../../hooks/useLocationwiseStock';
import {
  Card,
  StatusBadge,
  EmptyState,
  Skeleton,
  SearchInput,
} from '../../components/shared';
import { formatCurrency, formatTimeAgo, formatFullDate } from '../../utils/formatters';
import type { Order } from '../../types';

const REJECTED_LIMIT = 100;

type RejectFilter = 'all' | 'account_holds' | 'terminal';

function OrderCard({
  order,
  onTap,
  onRevive,
  isReviving,
}: {
  order: Order;
  onTap: () => void;
  onRevive?: () => void;
  isReviving?: boolean;
}) {
  const showRevive = canRevive(order);
  const rejectionNote =
    order.rejection_kind === 'account_hold'
      ? accountHoldDisplayNote(order.notes)
      : order.notes?.trim();

  return (
    <Card pressable onClick={onTap} className="min-h-14">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <span className="font-mono text-sm text-[var(--content-secondary)]">
            {order.order_number}
          </span>
          <StatusBadge
            status={order.workflow_status}
            rejectionKind={order.rejection_kind}
            className="text-xs shrink-0"
          />
        </div>
        <p className="font-bold text-[var(--content-primary)]">{order.customer_name}</p>
        <p className="text-sm text-[var(--content-secondary)]">{order.salesperson_name}</p>
        {rejectionNote && (
          <p className="text-xs text-[var(--content-tertiary)] whitespace-pre-wrap">
            {rejectionNote}
            {order.rejection_kind === 'account_hold' && order.held_at && (
              <span className="text-[var(--content-quaternary)]">
                {' '}
                · held {formatTimeAgo(order.held_at)}
              </span>
            )}
          </p>
        )}
        <div className="flex items-center justify-between text-sm gap-3">
          <span className="font-mono text-[var(--content-secondary)]">
            {order.item_count} items · {formatCurrency(order.total_value)}
          </span>
          <span
            className="text-[var(--content-tertiary)] shrink-0"
            title={formatFullDate(order.created_at)}
          >
            {formatTimeAgo(order.created_at)}
          </span>
        </div>
        {showRevive && onRevive && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRevive();
            }}
            disabled={isReviving}
            className="mt-1 w-full min-h-11 rounded-xl bg-[var(--role-primary)] text-sm font-semibold text-[var(--role-content)] disabled:opacity-50"
          >
            {isReviving ? 'Reviving…' : 'Return to billing queue'}
          </button>
        )}
      </div>
    </Card>
  );
}

export default function RejectedPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userId, userName } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<RejectFilter>('all');
  const [reviveTarget, setReviveTarget] = useState<Order | null>(null);

  const { data: orders, isLoading, error } = useOrders({
    status: 'rejected',
    limit: REJECTED_LIMIT,
    sort: 'newest-first',
    rejectionKind: kindFilter === 'account_holds' ? 'account_hold' : undefined,
  });

  const filteredOrders = useMemo(() => {
    let list = orders ?? [];
    if (kindFilter === 'terminal') {
      list = list.filter((o) => !isAccountHold(o));
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (o) =>
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q) ||
        o.salesperson_name.toLowerCase().includes(q),
    );
  }, [orders, searchQuery, kindFilter]);

  const { accountHolds, terminalRejects } = useMemo(() => {
    const holds: Order[] = [];
    const terminal: Order[] = [];
    for (const order of filteredOrders) {
      if (isAccountHold(order)) holds.push(order);
      else terminal.push(order);
    }
    return { accountHolds: holds, terminalRejects: terminal };
  }, [filteredOrders]);

  const reviveMutation = useMutation({
    mutationFn: async (target: Order) => {
      if (!userId) throw new Error('Not signed in');
      const { data, error: rpcError } = await supabase.rpc('revive_billing_order', {
        p_order_id: target.id,
        p_actor_user_id: userId,
        p_actor_name: userName ?? 'Billing',
      });
      if (rpcError) throw rpcError;
      const payload = data as {
        success?: boolean;
        error?: string;
        lines?: Array<{ item_name?: string }>;
        warnings?: unknown[];
      };
      if (!payload?.success) {
        if (payload.error === 'insufficient_stock' && Array.isArray(payload.lines)) {
          const names = payload.lines
            .map((line) => line.item_name)
            .filter(Boolean)
            .join(', ');
          throw new Error(
            names
              ? `Insufficient stock for: ${names}`
              : 'Insufficient stock to revive this order',
          );
        }
        throw new Error(payload.error ?? 'revive_failed');
      }
      return { target, warnings: payload.warnings };
    },
    onSuccess: async ({ target, warnings }) => {
      setReviveTarget(null);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['order', target.id] });
      void invalidateLocationwiseStockQueries(queryClient);

      await sendInternalNotification({
        eventType: 'order_update_for_sales',
        orderId: target.id,
        orderNumber: target.order_number,
        customerName: target.customer_name,
        salespersonName: target.salesperson_name,
        messageBody: `Order ${target.order_number} is back in the billing queue after account hold was cleared.`,
      }).catch((e) => {
        console.error('order_update_for_sales', e);
        toast.error(
          `Sales notification failed: ${formatInternalNotificationError(e)}`,
        );
      });

      const warningCount = Array.isArray(warnings) ? warnings.length : 0;
      toast.success(
        warningCount > 0
          ? `Order revived with ${warningCount} line qty adjustment${warningCount === 1 ? '' : 's'}`
          : 'Order returned to billing queue',
      );
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to revive order');
    },
  });

  const handleConfirmRevive = useCallback(() => {
    if (!reviveTarget) return;
    reviveMutation.mutate(reviveTarget);
  }, [reviveTarget, reviveMutation]);

  const showSections = kindFilter === 'all' && !searchQuery.trim();
  const isEmpty = filteredOrders.length === 0;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="p-4 lg:px-8 lg:py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-[var(--content-primary)]">
          Rejected Orders
        </h1>
        <p className="text-sm lg:text-base text-[var(--content-secondary)] mt-1">
          Account holds and orders rejected by billing
        </p>

        <div className="mt-6 space-y-4">
          <SearchInput
            placeholder="Search by order, customer, or salesperson..."
            value={searchQuery}
            onChange={setSearchQuery}
            autoFocus={false}
          />

          <div className="flex flex-wrap gap-2">
            {(
              [
                { value: 'all', label: 'All' },
                { value: 'account_holds', label: 'Account holds' },
                { value: 'terminal', label: 'Rejected' },
              ] as const
            ).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setKindFilter(value)}
                className={`min-h-9 px-3 rounded-full text-sm font-semibold transition-colors ${
                  kindFilter === value
                    ? 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                    : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)] hover:bg-[var(--bg-secondary)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton variant="card" count={4} />
            </div>
          ) : error ? (
            <p className="text-[var(--content-negative)]">Failed to load rejected orders</p>
          ) : isEmpty ? (
            <EmptyState
              icon={Prohibit}
              title="No rejected orders"
              description={
                searchQuery
                  ? 'Try a different search or adjust filters'
                  : 'Rejected orders will appear here'
              }
            />
          ) : showSections ? (
            <div className="space-y-8">
              {accountHolds.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold text-[var(--content-warning)] mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[var(--bg-warning)]" />
                    Account holds ({accountHolds.length})
                  </h2>
                  <p className="text-sm text-[var(--content-tertiary)] mb-3 -mt-1">
                    Unlock the account in Busy, then return the order to the billing queue.
                  </p>
                  <div className="space-y-3">
                    {accountHolds.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        onTap={() => navigate(`/billing/review/${order.id}`)}
                        onRevive={() => setReviveTarget(order)}
                        isReviving={reviveMutation.isPending && reviveTarget?.id === order.id}
                      />
                    ))}
                  </div>
                </section>
              )}
              {terminalRejects.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold text-[var(--content-primary)] mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[var(--bg-negative)]" />
                    Rejected ({terminalRejects.length})
                  </h2>
                  <div className="space-y-3">
                    {terminalRejects.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        onTap={() => navigate(`/billing/review/${order.id}`)}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm text-[var(--content-secondary)] mb-4">
                Showing {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
              </p>
              <div className="space-y-3">
                {filteredOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    onTap={() => navigate(`/billing/review/${order.id}`)}
                    onRevive={() => setReviveTarget(order)}
                    isReviving={reviveMutation.isPending && reviveTarget?.id === order.id}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {reviveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="ds-card p-6 max-w-md w-full shadow-xl animate-slide-up"
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-base font-bold text-[var(--content-primary)] mb-2">
              Return {reviveTarget.order_number} to billing?
            </h3>
            <p className="text-sm text-[var(--content-secondary)] mb-4">
              Confirm the customer account is unlocked in Busy. Stock reservations will be
              recreated and the order re-enters the Live Queue.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setReviveTarget(null)}
                disabled={reviveMutation.isPending}
                className="flex-1 h-11 rounded-xl border border-[var(--border-opaque)] text-sm font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRevive}
                disabled={reviveMutation.isPending}
                className="flex-1 h-11 rounded-xl bg-[var(--role-primary)] text-sm font-semibold text-[var(--role-content)] disabled:opacity-50"
              >
                {reviveMutation.isPending ? 'Reviving…' : 'Confirm revive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
