import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Package, Warning } from '@phosphor-icons/react';
import { useOrders, useOverdueOrders } from '../../hooks/useOrders';
import {
  Card,
  StatusBadge,
  EmptyState,
  Skeleton,
} from '../../components/shared';
import { formatCurrency, formatTimeAgo } from '../../utils/formatters';
import type { Order, OrderStatus } from '../../types';

const STAT_CONFIG: {
  status: OrderStatus;
  label: string;
  bg: string;
  text: string;
  border: string;
}[] = [
  {
    status: 'submitted',
    label: 'Submitted',
    bg: 'bg-[var(--bg-accent-subtle)]',
    text: 'text-[var(--content-accent)]',
    border: 'border-[var(--border-accent)]',
  },
  {
    status: 'approved',
    label: 'Approved',
    bg: 'bg-[var(--bg-positive-subtle)]',
    text: 'text-[var(--content-positive)]',
    border: 'border-[var(--border-positive)]',
  },
  {
    status: 'picking',
    label: 'Picking',
    bg: 'bg-[var(--bg-warning-subtle)]',
    text: 'text-[var(--content-warning)]',
    border: 'border-[var(--border-warning)]',
  },
  {
    status: 'completed',
    label: 'Completed',
    bg: 'bg-[var(--bg-tertiary)]',
    text: 'text-[var(--content-secondary)]',
    border: 'border-[var(--border-opaque)]',
  },
];

function StatCard({
  label,
  count,
  isActive,
  onClick,
  config,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
  config: (typeof STAT_CONFIG)[0];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex-1 min-w-0 rounded-xl p-4 lg:p-5 text-left
        transition-all duration-150
        border-2
        ${config.bg} ${config.text} ${config.border}
        ${isActive ? 'ring-2 ring-offset-2 ring-[var(--role-primary)] scale-[1.02]' : 'hover:opacity-90'}
      `}
    >
      <p className="text-xs font-semibold uppercase tracking-wider opacity-80">
        {label}
      </p>
      <p className="text-2xl lg:text-3xl font-bold tabular-nums mt-1">
        {count}
      </p>
    </button>
  );
}

function OrderCard({
  order,
  onTap,
}: {
  order: Order;
  onTap: () => void;
}) {
  return (
    <Card pressable onClick={onTap} className="min-h-[56px]">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <span className="font-mono text-sm text-[var(--content-tertiary)]">
            {order.order_number}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {order.priority === 'urgent' && order.status !== 'completed' && (
              <StatusBadge status="urgent" className="text-xs" />
            )}
            <StatusBadge status={order.status} />
          </div>
        </div>
        <p className="font-bold text-[var(--content-primary)]">{order.customer_name}</p>
        <p className="text-sm text-[var(--content-secondary)]">{order.salesperson_name}</p>
        <div className="flex items-center justify-between text-sm">
          <span className="font-mono text-[var(--content-secondary)]">
            {order.item_count} items · {formatCurrency(order.total_value)}
          </span>
          <span className="text-[var(--content-tertiary)]">{formatTimeAgo(order.created_at)}</span>
        </div>
      </div>
    </Card>
  );
}

const VALID_STATUSES: OrderStatus[] = [
  'submitted',
  'approved',
  'picking',
  'completed',
  'flagged',
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status') as OrderStatus | null;
  const statusFilter = statusParam && VALID_STATUSES.includes(statusParam)
    ? statusParam
    : null;

  const setStatusFilter = (statusOrUpdater: OrderStatus | null | ((prev: OrderStatus | null) => OrderStatus | null)) => {
    const next = typeof statusOrUpdater === 'function' ? statusOrUpdater(statusFilter) : statusOrUpdater;
    if (next) {
      setSearchParams({ status: next });
    } else {
      setSearchParams({});
    }
  };

  const { data: orders, isLoading, error } = useOrders({
    todayOnly: true,
  });
  const { data: overdueOrders } = useOverdueOrders();
  const overdueCount = overdueOrders?.length ?? 0;

  const { counts, filteredOrders } = useMemo(() => {
    const list = orders ?? [];
    const counts: Record<OrderStatus, number> = {
      submitted: 0,
      approved: 0,
      picking: 0,
      completed: 0,
      dispatched: 0,
      flagged: 0,
    };
    for (const o of list) {
      if (o.status in counts) counts[o.status as OrderStatus]++;
    }
    const filtered =
      statusFilter === null
        ? list
        : list.filter((o) => o.status === statusFilter);
    return { counts, filteredOrders: filtered };
  }, [orders, statusFilter]);

  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="p-4 lg:px-8 lg:py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-[var(--content-primary)]">
          Billing Dashboard
        </h1>
        <p className="text-sm lg:text-base text-[var(--content-secondary)] mt-1">
          {todayStr} · Today&apos;s orders
        </p>

        {overdueCount > 0 && (
          <button
            type="button"
            onClick={() => navigate('/billing/needs-review')}
            className="mt-4 w-full flex items-center gap-3 p-4 rounded-xl bg-[var(--bg-warning-subtle)] border-2 border-[var(--border-warning)] text-[var(--content-warning)] hover:opacity-90 transition-colors text-left"
          >
            <Warning size={24} weight="fill" className="shrink-0" />
            <div>
              <p className="font-semibold">
                {overdueCount} order{overdueCount !== 1 ? 's' : ''} from previous days need review
              </p>
              <p className="text-sm opacity-90">Tap to view and process</p>
            </div>
          </button>
        )}

        <div className="grid grid-cols-4 gap-2 lg:gap-4 mt-6">
          {STAT_CONFIG.map((config) => (
            <StatCard
              key={config.status}
              label={config.label}
              count={counts[config.status] ?? 0}
              isActive={statusFilter === config.status}
              onClick={() =>
                setStatusFilter((prev) =>
                  prev === config.status ? null : config.status
                )
              }
              config={config}
            />
          ))}
        </div>

        <div className="mt-6 lg:mt-8">
          <h2 className="text-lg font-semibold text-[var(--content-primary)] mb-4">
            Orders
            {statusFilter && (
              <span className="font-normal text-[var(--content-secondary)] ml-2">
                · {STAT_CONFIG.find((c) => c.status === statusFilter)?.label}
              </span>
            )}
          </h2>

          {isLoading ? (
            <div className="space-y-3">
              <Skeleton variant="card" count={4} />
            </div>
          ) : error ? (
            <p className="text-[var(--content-negative)]">Failed to load orders</p>
          ) : !filteredOrders.length ? (
            <EmptyState
              icon={Package}
              title="No orders"
              description={
                statusFilter
                  ? `No ${STAT_CONFIG.find((c) => c.status === statusFilter)?.label.toLowerCase()} orders today`
                  : "No orders today yet"
              }
            />
          ) : (
            <div className="space-y-3 lg:space-y-4">
              {filteredOrders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onTap={() => navigate(`/billing/review/${order.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
