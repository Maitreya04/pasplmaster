import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Package, Warning } from '@phosphor-icons/react';
import { useOverdueOrders } from '../../hooks/useOrders';
import { useClaimableOrders } from '../../hooks/useClaimableOrders';
import {
  Card,
  StatusBadge,
  EmptyState,
  Skeleton,
  BillingApproverChip,
  PickerAttributionChip,
} from '../../components/shared';
import { formatCurrency, formatTimeAgo } from '../../utils/formatters';
import type { WorkflowStatus } from '../../types';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';

const STAT_CONFIG: {
  status: WorkflowStatus;
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
  order: OrderWithClaimInfo;
  onTap: () => void;
}) {
  const claim = order.claim_info;
  const timeSource = order.approved_at ?? order.created_at;

  return (
    <Card
      pressable
      onClick={onTap}
      className={`
        !p-4 min-h-0
        ${claim?.is_stale ? 'border-[var(--border-warning)] ring-1 ring-[var(--border-warning)]' : ''}
      `}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <span className="font-mono text-xs sm:text-sm text-[var(--content-tertiary)] min-w-0 pt-0.5 tabular-nums">
            {order.order_number}
          </span>
          <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0 max-w-[min(100%,20rem)]">
            {order.priority === 'urgent' && order.workflow_status !== 'completed' && (
              <StatusBadge status="urgent" className="text-xs" />
            )}
            <StatusBadge status={order.workflow_status} />
            {order.reviewer_name && <BillingApproverChip name={order.reviewer_name} />}
            {order.picker_name ? (
              <PickerAttributionChip
                name={order.picker_name}
                active={order.workflow_status === 'picking'}
              />
            ) : (
              order.workflow_status === 'approved' &&
              order.fulfillment_path !== 'direct_bill' && (
                <span className="inline-flex items-center h-6 px-3 rounded-full border border-[var(--border-opaque)] bg-[var(--bg-tertiary)] text-xs font-semibold text-[var(--content-tertiary)]">
                  Waiting for picker
                </span>
              )
            )}
          </div>
        </div>

        {order.workflow_status === 'picking' && order.picker_name && (
          <div className="text-xs px-2 py-1 rounded-md inline-flex w-max max-w-full bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] font-semibold">
            Picking by {order.picker_name}
            {order.picked_at && (
              <span className="font-normal opacity-90">
                {' '}
                · since {formatTimeAgo(order.picked_at)}
              </span>
            )}
          </div>
        )}

        {order.workflow_status === 'submitted' && claim && (
          <div
            className={`text-xs px-2 py-1 rounded-md inline-flex w-max max-w-full ${
              claim.is_stale
                ? 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] font-semibold'
                : order.is_mine
                  ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] font-semibold'
                  : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
            }`}
          >
            {claim.is_stale
              ? `Stale claim by ${claim.claimed_by_name} (${formatTimeAgo(claim.last_heartbeat_at)})`
              : order.is_mine
                ? 'Claimed by you'
                : `Processing by ${claim.claimed_by_name}`}
          </div>
        )}

        <div className="flex flex-col gap-0.5 pt-0.5">
          <p className="font-bold text-[var(--content-primary)] leading-snug text-base">
            {order.customer_name}
          </p>
          <p className="text-sm text-[var(--content-secondary)] leading-snug">{order.salesperson_name}</p>
        </div>

        <div className="flex items-baseline justify-between gap-3 pt-2 mt-0.5 border-t border-[var(--border-subtle)] text-sm">
          <span className="font-mono text-[var(--content-secondary)] min-w-0">
            {order.item_count} items · {formatCurrency(order.total_value)}
          </span>
          <span className="text-xs sm:text-sm text-[var(--content-tertiary)] shrink-0 tabular-nums">
            {formatTimeAgo(timeSource)}
          </span>
        </div>
      </div>
    </Card>
  );
}

const VALID_STATUSES: WorkflowStatus[] = [
  'submitted',
  'approved',
  'picking',
  'completed',
  'flagged',
];

export default function DashboardPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status') as WorkflowStatus | null;
  const statusFilter = statusParam && VALID_STATUSES.includes(statusParam)
    ? statusParam
    : null;

  const setStatusFilter = (statusOrUpdater: WorkflowStatus | null | ((prev: WorkflowStatus | null) => WorkflowStatus | null)) => {
    const next = typeof statusOrUpdater === 'function' ? statusOrUpdater(statusFilter) : statusOrUpdater;
    if (next) {
      setSearchParams({ status: next });
    } else {
      setSearchParams({});
    }
  };

  // We use useClaimableOrders to fetch all orders but specifically enrich claims for 'billing' stage
  const { all: orders, isLoading } = useClaimableOrders({
    stage: 'billing',
    todayOnly: true,
  });

  const { data: overdueOrders } = useOverdueOrders();
  const overdueCount = overdueOrders?.length ?? 0;
  
  const { counts, filteredOrders } = useMemo(() => {
    const list = orders ?? [];
    const counts: Record<WorkflowStatus, number> = {
      submitted: 0,
      approved: 0,
      picking: 0,
      completed: 0,
      rejected: 0,
      flagged: 0,
    };
    for (const o of list) {
      if (o.workflow_status in counts) counts[o.workflow_status as WorkflowStatus]++;
    }
    const filtered =
      statusFilter === null
        ? list
        : list.filter((o) => o.workflow_status === statusFilter);
    return { counts, filteredOrders: filtered };
    // eslint-disable-next-line react-hooks/preserve-manual-memoization
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
                  onTap={() => {
                    if (order.workflow_status === 'submitted') {
                      navigate(`/billing/queue?orderId=${order.id}`);
                    } else {
                      navigate(`/billing/review/${order.id}`);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
