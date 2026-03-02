import { useNavigate } from 'react-router-dom';
import { ClipboardText } from '@phosphor-icons/react';
import { useOrders, useOverdueOrders } from '../../hooks/useOrders';
import { Card, StatusBadge, EmptyState, Skeleton } from '../../components/shared';
import type { Order } from '../../types';

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

function formatOverdueDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function OrderCard({
  order,
  onTap,
  isOverdue,
}: {
  order: Order;
  onTap: () => void;
  isOverdue?: boolean;
}) {
  return (
    <Card pressable onClick={onTap} className="min-h-[56px]">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <span className="font-mono text-sm text-slate-600">
            {order.order_number}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {isOverdue && (
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-amber-200 text-amber-800">
                Since {formatOverdueDate(order.created_at)}
              </span>
            )}
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
          <span className="text-slate-500">{formatTimeAgo(order.created_at)}</span>
        </div>
      </div>
    </Card>
  );
}

export default function NeedsReviewPage() {
  const navigate = useNavigate();
  const { data: overdueOrders, isLoading: overdueLoading } = useOverdueOrders();
  const { data: todaySubmitted, isLoading: todayLoading } = useOrders({
    todayOnly: true,
    status: 'submitted',
  });

  const isLoading = overdueLoading || todayLoading;
  const hasOverdue = (overdueOrders?.length ?? 0) > 0;
  const hasToday = (todaySubmitted?.length ?? 0) > 0;
  const isEmpty = !hasOverdue && !hasToday;

  return (
    <div className="min-h-screen bg-[var(--navy-50)]">
      <div className="p-4 lg:px-8 lg:py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">
          Needs Review
        </h1>
        <p className="text-sm lg:text-base text-slate-600 mt-1">
          Overdue and today&apos;s submitted orders
        </p>

        {isLoading ? (
          <div className="mt-6 space-y-3">
            <Skeleton variant="card" count={4} />
          </div>
        ) : isEmpty ? (
          <EmptyState
            icon={ClipboardText}
            title="All caught up"
            description="No orders need review right now"
          />
        ) : (
          <div className="mt-6 lg:mt-8 space-y-8">
            {/* Section 1: Overdue */}
            {hasOverdue && (
              <section>
                <h2 className="text-lg font-semibold text-amber-800 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  From previous days ({overdueOrders!.length})
                </h2>
                <div className="space-y-3">
                  {overdueOrders!.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onTap={() => navigate(`/billing/review/${order.id}`)}
                      isOverdue
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Section 2: Today's submitted */}
            {hasToday && (
              <section>
                <h2 className="text-lg font-semibold text-slate-800 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  Today&apos;s submitted ({todaySubmitted!.length})
                </h2>
                <div className="space-y-3">
                  {todaySubmitted!.map((order) => (
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
        )}
      </div>
    </div>
  );
}
