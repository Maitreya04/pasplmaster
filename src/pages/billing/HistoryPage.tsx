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
import { formatCurrency, formatTimeAgo, formatFullDate } from '../../utils/formatters';
import type { Order, OrderStatus } from '../../types';

const HISTORY_LIMIT = 100;

type DateRange = '7' | '30' | 'all';

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
          <span className="font-mono text-sm text-[var(--content-secondary)]">
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
          <span className="text-[var(--content-tertiary)]" title={formatFullDate(order.created_at)}>
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
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="p-4 lg:px-8 lg:py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-[var(--content-primary)]">
          Order History
        </h1>
        <p className="text-sm lg:text-base text-[var(--content-secondary)] mt-1">
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
                  className="appearance-none h-9 pl-3 pr-8 rounded-lg border border-[var(--border-opaque)] bg-[var(--bg-secondary)] text-[var(--content-primary)] text-sm font-medium leading-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
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
                  onChange={(e) => setStatusFilter(e.target.value as OrderStatus | 'all')}
                  className="appearance-none h-9 pl-3 pr-8 rounded-lg border border-[var(--border-opaque)] bg-[var(--bg-secondary)] text-[var(--content-primary)] text-sm font-medium leading-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
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

        {/* Order list */}
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
