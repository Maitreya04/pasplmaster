import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { useOrders } from '../../hooks/useOrders';
import {
  Card,
  StatusBadge,
  EmptyState,
  Skeleton,
  SearchInput,
} from '../../components/shared';
import type { Order, OrderStatus } from '../../types';

const HISTORY_LIMIT = 100;

type DateRange = '7' | '30' | 'all';

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

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getDateFromIso(range: DateRange): string | undefined {
  if (range === 'all') return undefined;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const days = range === '7' ? 7 : 30;
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const STATUS_OPTIONS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved', label: 'Approved' },
  { value: 'picking', label: 'Picking' },
  { value: 'completed', label: 'Completed' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'dispatched', label: 'Dispatched' },
];

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
            {order.priority === 'urgent' && (
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
          <span className="text-slate-500" title={formatFullDate(order.created_at)}>
            {formatTimeAgo(order.created_at)}
          </span>
        </div>
      </div>
    </Card>
  );
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('7');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'all'>('all');

  const dateFrom = getDateFromIso(dateRange);

  const { data: orders, isLoading, error } = useOrders({
    todayOnly: false,
    dateFrom,
    limit: HISTORY_LIMIT,
    status: statusFilter === 'all' ? undefined : statusFilter,
  });

  const filteredOrders = useMemo(() => {
    const list = orders ?? [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (o) =>
        o.order_number.toLowerCase().includes(q) ||
        o.customer_name.toLowerCase().includes(q)
    );
  }, [orders, searchQuery]);

  return (
    <div className="min-h-screen bg-[var(--navy-50)]">
      <div className="p-4 lg:px-8 lg:py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">
          Order History
        </h1>
        <p className="text-sm lg:text-base text-slate-600 mt-1">
          Search and filter past orders
        </p>

        {/* Filters */}
        <div className="mt-6 space-y-4">
          <SearchInput
            placeholder="Search by order number or customer..."
            value={searchQuery}
            onChange={setSearchQuery}
            autoFocus={false}
          />

          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="date-range" className="text-sm font-medium text-slate-700">
                Period:
              </label>
              <select
                id="date-range"
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as DateRange)}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900 text-sm"
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="all">All</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="status-filter" className="text-sm font-medium text-slate-700">
                Status:
              </label>
              <select
                id="status-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'all')}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-900 text-sm"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Order list */}
        <div className="mt-6">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton variant="card" count={4} />
            </div>
          ) : error ? (
            <p className="text-red-600">Failed to load orders</p>
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
              <p className="text-sm text-slate-600 mb-4">
                Showing {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
                {dateRange !== 'all' && ` (last ${dateRange} days)`}
              </p>
              <div className="space-y-3 lg:space-y-4">
                {filteredOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    onTap={() => navigate(`/billing/review/${order.id}`)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
