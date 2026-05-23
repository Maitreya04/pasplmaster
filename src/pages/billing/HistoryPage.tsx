import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClockCounterClockwise } from '@phosphor-icons/react';
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
import type { Order, WorkflowStatus } from '../../types';

const HISTORY_LIMIT = 100;

type DateRange = '7' | '30' | 'all';
type HistoryStatusFilter = WorkflowStatus | 'all' | 'account_holds';

function getDateFromIso(range: DateRange): string | undefined {
  if (range === 'all') return undefined;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const days = range === '7' ? 7 : 30;
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const STATUS_OPTIONS: { value: HistoryStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'picking', label: 'Picking' },
  { value: 'completed', label: 'Completed' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'account_holds', label: 'Account holds' },
];

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

  return (
    <Card pressable onClick={onTap} className="min-h-14">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <span className="font-mono text-sm text-[var(--content-secondary)]">
            {order.order_number}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {order.priority === 'urgent' && order.workflow_status !== 'completed' && (
              <StatusBadge status="urgent" className="text-xs" />
            )}
            <StatusBadge
              status={order.workflow_status}
              rejectionKind={order.rejection_kind}
              className="text-xs"
            />
          </div>
        </div>
        <p className="font-bold text-[var(--content-primary)]">{order.customer_name}</p>
        <p className="text-sm text-[var(--content-secondary)]">{order.salesperson_name}</p>
        {order.rejection_kind === 'account_hold' && (
          <p className="text-xs text-[var(--content-warning)] whitespace-pre-wrap">
            {accountHoldDisplayNote(order.notes)}
            {order.held_at && (
              <span className="text-[var(--content-tertiary)]">
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
          <span className="text-[var(--content-tertiary)] shrink-0" title={formatFullDate(order.created_at)}>
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

export default function HistoryPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userId, userName } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('7');
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('all');
  const [reviveTarget, setReviveTarget] = useState<Order | null>(null);

  const dateFrom = getDateFromIso(dateRange);

  const ordersQueryStatus: WorkflowStatus | undefined =
    statusFilter === 'all'
      ? undefined
      : statusFilter === 'account_holds'
        ? 'rejected'
        : statusFilter;

  const { data: orders, isLoading, error } = useOrders({
    todayOnly: false,
    dateFrom,
    limit: HISTORY_LIMIT,
    status: ordersQueryStatus,
    rejectionKind: statusFilter === 'account_holds' ? 'account_hold' : undefined,
  });

  const filteredOrders = useMemo(() => {
    const list = orders ?? [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (o) =>
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q),
    );
  }, [orders, searchQuery, statusFilter]);

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

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="p-4 lg:px-8 lg:py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-[var(--content-primary)]">
          Order History
        </h1>
        <p className="text-sm lg:text-base text-[var(--content-secondary)] mt-1">
          Search and filter past orders
        </p>

        <div className="mt-6 space-y-4">
          <SearchInput
            placeholder="Search by order number or customer..."
            value={searchQuery}
            onChange={setSearchQuery}
            autoFocus={false}
          />

          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label htmlFor="date-range" className="text-sm font-medium text-[var(--content-secondary)] whitespace-nowrap">
                Period:
              </label>
              <div className="relative">
                <select
                  id="date-range"
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as DateRange)}
                  className="appearance-none min-h-11 pl-3 pr-8 rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] text-[var(--content-primary)] text-sm font-medium leading-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                >
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="all">All</option>
                </select>
                <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--content-tertiary)]" width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="status-filter" className="text-sm font-medium text-[var(--content-secondary)] whitespace-nowrap">
                Status:
              </label>
              <div className="relative">
                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as HistoryStatusFilter)}
                  className="appearance-none min-h-11 pl-3 pr-8 rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] text-[var(--content-primary)] text-sm font-medium leading-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--content-tertiary)]" width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton variant="card" count={4} />
            </div>
          ) : error ? (
            <p className="text-[var(--content-negative)]">Failed to load orders</p>
          ) : !filteredOrders.length ? (
            <EmptyState
              icon={ClockCounterClockwise}
              title="No orders found"
              description={
                searchQuery
                  ? 'Try a different search or adjust filters'
                  : 'No orders in this period'
              }
            />
          ) : (
            <>
              <p className="text-sm text-[var(--content-secondary)] mb-4">
                Showing {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
                {dateRange !== 'all' && ` (last ${dateRange} days)`}
              </p>
              <div className="space-y-3 lg:space-y-4">
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
