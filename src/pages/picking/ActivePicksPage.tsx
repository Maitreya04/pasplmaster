import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UsersThree } from '@phosphor-icons/react';
import { useClaimableOrders } from '../../hooks/useClaimableOrders';
import { useAuth } from '../../context/AuthContext';
import {
  PageHeader,
  EmptyState,
  Skeleton,
  QueueSectionHeader,
  FilterChip,
} from '../../components/shared';
import { ActivePickRow, useActivePickBoardOrders } from '../../components/picking/ActivePickRow';
import { AvailableOrderRow } from '../../components/picking/AvailableOrderRow';
import { sortAvailablePickQueueOrders } from '../../lib/pickQueueTransport';
import {
  isAssignedToMe,
  isMyAssignedPending,
  isMyAssignedWorkCleared,
  isMyInProgressPick,
  isPickStarted,
} from '../../lib/picking/pickLifecycle';

type ActiveFilter = 'all' | 'mine' | 'in_progress' | 'stale';

function hasPickableLines(order: { pick_line_count?: number; item_count: number }): boolean {
  if (order.pick_line_count != null) return order.pick_line_count > 0;
  return order.item_count > 0;
}

export default function ActivePicksPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { userName } = useAuth();
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const { available, myActive, otherActive, stale, isLoading } = useClaimableOrders({
    stage: 'picking',
    workflowStatus: ['approved', 'picking'],
  });

  const boardOrders = useActivePickBoardOrders(myActive, otherActive);

  const filteredOrders = useMemo(() => {
    if (filter === 'mine') {
      return boardOrders.filter((order) => order.is_mine);
    }
    if (filter === 'in_progress') {
      return boardOrders.filter((order) => isPickStarted(order.workflow_status));
    }
    if (filter === 'stale') {
      return boardOrders.filter(
        (order) => order.claim_info?.is_stale && order.workflow_status === 'picking',
      );
    }
    return boardOrders;
  }, [boardOrders, filter]);

  const myOrderIds = useMemo(
    () => new Set(myActive.map((order) => order.id)),
    [myActive],
  );

  const inProgressPicks = useMemo(
    () => myActive.filter((order) => isMyInProgressPick(order, userName)),
    [myActive, userName],
  );

  const assignedWorkCleared = useMemo(
    () => isMyAssignedWorkCleared(myActive, userName),
    [myActive, userName],
  );

  const unassignedOrders = useMemo(
    () => sortAvailablePickQueueOrders(available.filter(hasPickableLines)),
    [available],
  );

  const stalePoolOrders = useMemo(
    () => sortAvailablePickQueueOrders(stale.filter(hasPickableLines)),
    [stale],
  );

  const poolVisible = assignedWorkCleared;
  const poolHasOrders = unassignedOrders.length > 0 || stalePoolOrders.length > 0;

  const handleOpen = (orderId: number, order: (typeof boardOrders)[number]) => {
    if (!isAssignedToMe(order, userName)) return;
    if (isMyInProgressPick(order, userName)) {
      navigate(`/picking/pick/${orderId}`);
      return;
    }
    if (isMyAssignedPending(order, userName)) {
      navigate(`/picking/preview/${orderId}?source=assigned`);
    }
  };

  const handlePoolOpen = (orderId: number) => {
    if (inProgressPicks.length > 0) return;
    navigate(`/picking/preview/${orderId}?source=pool`);
  };

  const inProgressCount = boardOrders.filter((o) => isPickStarted(o.workflow_status)).length;
  const staleCount = boardOrders.filter(
    (o) => o.claim_info?.is_stale && o.workflow_status === 'picking',
  ).length;

  return (
    <div className="min-h-screen pb-8">
      <PageHeader title="Team" />

      <div className="space-y-4 p-4">
        <p className="text-sm text-[var(--content-secondary)]">
          Who is picking which order right now. Your rows open the pick deck; teammates are
          read-only.
        </p>

        <div className="flex flex-wrap gap-2">
          <FilterChip
            label="Everyone"
            selected={filter === 'all'}
            onClick={() => setFilter('all')}
            count={boardOrders.length}
          />
          <FilterChip
            label="Mine"
            selected={filter === 'mine'}
            onClick={() => setFilter('mine')}
            count={boardOrders.filter((o) => o.is_mine).length}
          />
          <FilterChip
            label="Picking"
            selected={filter === 'in_progress'}
            onClick={() => setFilter('in_progress')}
            count={inProgressCount}
          />
          <FilterChip
            label="Stale"
            selected={filter === 'stale'}
            onClick={() => setFilter('stale')}
            count={staleCount}
          />
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton variant="card" count={4} />
          </div>
        ) : filteredOrders.length === 0 ? (
          <EmptyState
            icon={UsersThree}
            title="No active picks"
            description="Assigned and in-progress orders show up here in real time."
          />
        ) : (
          <section className="space-y-2">
            <QueueSectionHeader
              label={filter === 'mine' ? 'Your picks' : 'Active picks — team'}
              count={filteredOrders.length}
            />
            {filteredOrders.map((order) => (
              <ActivePickRow
                key={order.id}
                order={order}
                isMine={myOrderIds.has(order.id)}
                onOpen={
                  isAssignedToMe(order, userName)
                    ? () => handleOpen(order.id, order)
                    : undefined
                }
              />
            ))}
          </section>
        )}

        <section>
          <QueueSectionHeader
            label="Unassigned pool"
            count={unassignedOrders.length + stalePoolOrders.length}
            showWhenEmpty
            description="Claim only when billing has not assigned anyone"
            className={!poolVisible ? 'opacity-70' : undefined}
          />
          {!poolVisible ? (
            <p className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
              {inProgressPicks.length > 0
                ? 'Finish your open pick before claiming from the pool.'
                : 'Start or complete your queue assignments first — then unassigned orders appear here.'}
            </p>
          ) : !poolHasOrders ? (
            <p className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
              Pool is empty — new approved orders will show up here.
            </p>
          ) : (
            <div className="space-y-2">
              {unassignedOrders.map((order) => (
                <AvailableOrderRow
                  key={order.id}
                  order={order}
                  onOpen={() => handlePoolOpen(order.id)}
                  disabled={inProgressPicks.length > 0}
                />
              ))}
              {stalePoolOrders.length > 0 && (
                <>
                  <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
                    Abandoned picks (stale)
                  </p>
                  {stalePoolOrders.map((order) => (
                    <AvailableOrderRow
                      key={order.id}
                      order={order}
                      onOpen={() => handlePoolOpen(order.id)}
                      disabled={inProgressPicks.length > 0}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </section>
      </div>

    </div>
  );
}
