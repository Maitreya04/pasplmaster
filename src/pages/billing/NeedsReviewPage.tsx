import { useNavigate } from 'react-router-dom';
import { ClipboardText } from '@phosphor-icons/react';
import { useOrders, useOverdueOrders } from '../../hooks/useOrders';
import { Card, StatusBadge, EmptyState, Skeleton } from '../../components/shared';
import { formatCurrency, formatTimeAgo, formatOverdueDate } from '../../utils/formatters';
import type { Order } from '../../types';

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
          <span className="font-mono text-sm text-[var(--content-secondary)]">
            {order.order_number}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {isOverdue && (
              <span className="text-xs font-medium px-2 py-0.5 rounded bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]">
                Since {formatOverdueDate(order.created_at)}
              </span>
            )}
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
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="p-4 lg:px-8 lg:py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-[var(--content-primary)]">
          Needs Review
        </h1>
        <p className="text-sm lg:text-base text-[var(--content-secondary)] mt-1">
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
                <h2 className="text-lg font-semibold text-[var(--content-warning)] mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--bg-warning)]" />
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
                <h2 className="text-lg font-semibold text-[var(--content-primary)] mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--bg-accent)]" />
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
