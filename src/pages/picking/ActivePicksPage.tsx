import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, UsersThree } from '@phosphor-icons/react';
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
  isMyInProgressPick,
  isPickStarted,
} from '../../lib/picking/pickLifecycle';

type ActiveFilter = 'all' | 'mine' | 'in_progress' | 'stale';
type TeamView = 'team' | 'pool';

const SWIPE_THRESHOLD_PX = 48;

function hasPickableLines(order: { pick_line_count?: number; item_count: number }): boolean {
  if (order.pick_line_count != null) return order.pick_line_count > 0;
  return order.item_count > 0;
}

export default function ActivePicksPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { userName } = useAuth();
  const [view, setView] = useState<TeamView>('team');
  const [filter, setFilter] = useState<ActiveFilter>('all');
  const touchStartX = useRef<number | null>(null);
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

  const unassignedOrders = useMemo(
    () => sortAvailablePickQueueOrders(available.filter(hasPickableLines)),
    [available],
  );

  const stalePoolOrders = useMemo(
    () => sortAvailablePickQueueOrders(stale.filter(hasPickableLines)),
    [stale],
  );

  const poolCount = unassignedOrders.length + stalePoolOrders.length;
  const poolClaimBlocked = inProgressPicks.length > 0;

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
    if (poolClaimBlocked) return;
    navigate(`/picking/preview/${orderId}?source=pool`);
  };

  const inProgressCount = boardOrders.filter((o) => isPickStarted(o.workflow_status)).length;
  const staleCount = boardOrders.filter(
    (o) => o.claim_info?.is_stale && o.workflow_status === 'picking',
  ).length;

  const switchView = useCallback((next: TeamView) => {
    setView(next);
  }, []);

  const onTouchStart = useCallback((event: React.TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }, []);

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const startX = touchStartX.current;
      touchStartX.current = null;
      if (startX == null) return;
      const endX = event.changedTouches[0]?.clientX;
      if (endX == null) return;
      const delta = endX - startX;
      if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
      if (delta < 0 && view === 'team' && poolCount > 0) {
        switchView('pool');
      } else if (delta > 0 && view === 'pool') {
        switchView('team');
      }
    },
    [poolCount, switchView, view],
  );

  return (
    <div className="min-h-screen pb-8">
      <PageHeader title="Team" />

      <div
        className="space-y-4 p-4"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <p className="text-sm text-[var(--content-secondary)]">
          {view === 'team'
            ? 'Who is picking which order right now. Your rows open the pick deck; teammates are read-only.'
            : 'Unassigned orders anyone can claim. Swipe right to return to the team board.'}
        </p>

        <div className="flex gap-2">
          <FilterChip
            label="Active"
            selected={view === 'team'}
            onClick={() => switchView('team')}
            count={boardOrders.length}
          />
          <FilterChip
            label="Unassigned"
            selected={view === 'pool'}
            onClick={() => switchView('pool')}
            count={poolCount}
          />
        </div>

        {view === 'team' ? (
          <>
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
                description={
                  poolCount > 0
                    ? 'Nothing in progress right now — swipe to Unassigned to claim open orders.'
                    : 'Assigned and in-progress orders show up here in real time.'
                }
                action={
                  poolCount > 0
                    ? { label: 'View unassigned', onClick: () => switchView('pool') }
                    : undefined
                }
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

            {poolCount > 0 ? (
              <button
                type="button"
                onClick={() => switchView('pool')}
                className="flex w-full items-center justify-between rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-left transition-colors hover:bg-[var(--bg-tertiary)] active:scale-[0.99]"
              >
                <span className="text-sm font-medium text-[var(--content-primary)]">
                  {poolCount} unassigned order{poolCount === 1 ? '' : 's'} available
                </span>
                <span className="text-xs font-semibold text-[var(--content-accent)]">
                  Swipe →
                </span>
              </button>
            ) : null}
          </>
        ) : (
          <section className="space-y-2">
            <QueueSectionHeader
              label="Unassigned pool"
              count={poolCount}
              showWhenEmpty
              description="Tap to claim — first come, first served"
            />
            {poolClaimBlocked ? (
              <p className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
                Finish your open pick before claiming from the pool.
              </p>
            ) : null}
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton variant="card" count={3} />
              </div>
            ) : poolCount === 0 ? (
              <EmptyState
                icon={Package}
                title="Pool is empty"
                description="New approved orders will show up here. Swipe right to see the team board."
                action={{ label: 'View active picks', onClick: () => switchView('team') }}
              />
            ) : (
              <div className="space-y-2">
                {unassignedOrders.map((order) => (
                  <AvailableOrderRow
                    key={order.id}
                    order={order}
                    onOpen={() => handlePoolOpen(order.id)}
                    disabled={poolClaimBlocked}
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
                        disabled={poolClaimBlocked}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
