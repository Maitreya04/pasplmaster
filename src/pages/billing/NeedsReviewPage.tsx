import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardText } from '@phosphor-icons/react';
import { useClaimableOrders } from '../../hooks/useClaimableOrders';
import { Card, StatusBadge, EmptyState, Skeleton, QueueDayTag } from '../../components/shared';
import { formatCurrency, formatTimeAgo } from '../../utils/formatters';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import { groupBillingQueueBySubmissionDay } from '../../lib/queueDayBuckets';

function OrderCard({
  order,
  onTap,
}: {
  order: OrderWithClaimInfo;
  onTap: () => void;
}) {
  const claim = order.claim_info;

  return (
    <Card pressable onClick={onTap} className={`min-h-14 ${claim?.is_stale ? 'border-[var(--border-warning)] ring-1 ring-[var(--border-warning)]' : ''}`}>
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <span className="font-mono text-sm text-[var(--content-secondary)]">
            {order.order_number}
          </span>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            {order.order_kind === 'recovery' && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[var(--bg-accent-subtle)] text-[var(--bg-accent)]">
                Recovery
              </span>
            )}
            <QueueDayTag order={order} variant="late_to_bill" />
            {order.priority === 'urgent' && order.workflow_status !== 'completed' && (
              <StatusBadge status="urgent" className="text-xs" />
            )}
            <StatusBadge status={order.workflow_status} />
          </div>
        </div>

        {/* Claim status row */}
        {claim && (
          <div className={`text-xs px-2 py-1 rounded inline-flex w-max ${
            claim.is_stale 
              ? 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] font-semibold'
              : order.is_mine
                ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] font-semibold'
                : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
          }`}>
            {claim.is_stale 
              ? `Stale claim by ${claim.claimed_by_name} (${formatTimeAgo(claim.last_heartbeat_at)})`
              : order.is_mine
                ? 'Claimed by you'
                : `Processing by ${claim.claimed_by_name}`
            }
          </div>
        )}

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

export default function NeedsReviewPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { all: submittedOrders, isLoading } = useClaimableOrders({
    stage: 'billing',
    workflowStatus: 'submitted',
  });

  const sections = useMemo(
    () => groupBillingQueueBySubmissionDay(submittedOrders),
    [submittedOrders],
  );

  const isEmpty = sections.length === 0;

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
            {sections.map((section) => (
              <section key={section.id}>
                <h2
                  className={`text-lg font-semibold mb-3 flex items-center gap-2 ${
                    section.id === 'today'
                      ? 'text-[var(--content-primary)]'
                      : 'text-[var(--content-warning)]'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      section.id === 'today'
                        ? 'bg-[var(--bg-accent)]'
                        : 'bg-[var(--bg-warning)]'
                    }`}
                  />
                  {section.title} ({section.orders.length})
                </h2>
                {section.description && (
                  <p className="text-sm text-[var(--content-tertiary)] mb-3 -mt-1">
                    {section.description}
                  </p>
                )}
                <div className="space-y-3">
                  {section.orders.map((order) => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      onTap={() => navigate(`/billing/review/${order.id}`)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
