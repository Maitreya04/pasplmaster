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
import type { Order, OrderStatus } from '../../types';

function formatCurrency(n: number) {
  return n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

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
    bg: 'bg-blue-100',
    text: 'text-blue-700',
    border: 'border-blue-200',
  },
  {
    status: 'approved',
    label: 'Approved',
    bg: 'bg-emerald-100',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
  },
  {
    status: 'picking',
    label: 'Picking',
    bg: 'bg-amber-100',
    text: 'text-amber-700',
    border: 'border-amber-200',
  },
  {
    status: 'completed',
    label: 'Completed',
    bg: 'bg-gray-100',
    text: 'text-gray-700',
    border: 'border-gray-200',
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
        ${isActive ? 'ring-2 ring-offset-2 ring-blue-500 scale-[1.02]' : 'hover:opacity-90'}
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
          <span className="font-mono text-sm text-slate-600">
            {order.order_number}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {order.priority === 'urgent' && order.status !== 'completed' && (
              <StatusBadge status="urgent" className="text-xs" />
            )}
            <StatusBadge status={order.status} />
          </div>
        </div>
        <p className="font-bold text-slate-900">{order.customer_name}</p>
        <p className="text-sm text-slate-600">{order.salesperson_name}</p>
        <div className="flex items-center justify-between text-sm">
          <span className="font-mono text-slate-700">
            {order.item_count} items · {formatCurrency(order.total_value)}
          </span>
          <span className="text-slate-500">{formatTimeAgo(order.created_at)}</span>
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
    <div className="min-h-screen bg-[var(--navy-50)]">
      <div className="p-4 lg:px-8 lg:py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">
          Billing Dashboard
        </h1>
        <p className="text-sm lg:text-base text-slate-600 mt-1">
          {todayStr} · Today&apos;s orders
        </p>

        {/* Overdue alert banner */}
        {overdueCount > 0 && (
          <button
            type="button"
            onClick={() => navigate('/billing/needs-review')}
            className="mt-4 w-full flex items-center gap-3 p-4 rounded-xl bg-amber-100 border-2 border-amber-300 text-amber-800 hover:bg-amber-200 transition-colors text-left"
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

        {/* Stat cards */}
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

        {/* Order list */}
        <div className="mt-6 lg:mt-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">
            Orders
            {statusFilter && (
              <span className="font-normal text-slate-600 ml-2">
                · {STAT_CONFIG.find((c) => c.status === statusFilter)?.label}
              </span>
            )}
          </h2>

          {isLoading ? (
            <div className="space-y-3">
              <Skeleton variant="card" count={4} />
            </div>
          ) : error ? (
            <p className="text-red-600">Failed to load orders</p>
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
