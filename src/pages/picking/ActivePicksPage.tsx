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
import { isInProgressPick, isMyAssignedPending } from '../../lib/picking/pickLifecycle';

type ActiveFilter = 'all' | 'mine' | 'stale';

export default function ActivePicksPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { userName } = useAuth();
  const [filter, setFilter] = useState<ActiveFilter>('all');

  const { myActive, otherActive, isLoading } = useClaimableOrders({
    stage: 'picking',
    workflowStatus: ['approved', 'picking'],
  });

  const boardOrders = useActivePickBoardOrders(myActive, otherActive);

  const filteredOrders = useMemo(() => {
    if (filter === 'mine') {
      return boardOrders.filter((order) => order.is_mine);
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

  const handleOpen = (orderId: number, order: (typeof boardOrders)[number]) => {
    if (!myOrderIds.has(orderId)) return;
    if (isInProgressPick(order)) {
      navigate(`/picking/pick/${orderId}`);
      return;
    }
    if (isMyAssignedPending(order, userName)) {
      navigate(`/picking/preview/${orderId}?source=assigned`);
    }
  };

  return (
    <div className="min-h-screen">
      <PageHeader title="Active picks" />

      <div className="space-y-4 p-4">
        <p className="text-sm text-[var(--content-secondary)]">
          Live view of who is picking which order — check here if there is any confusion.
        </p>

        <div className="flex flex-wrap gap-2">
          <FilterChip
            label="All"
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
            label="Stale"
            selected={filter === 'stale'}
            onClick={() => setFilter('stale')}
            count={
              boardOrders.filter(
                (o) => o.claim_info?.is_stale && o.workflow_status === 'picking',
              ).length
            }
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
            description="Assigned and in-progress orders will show up here in real time."
          />
        ) : (
          <section className="space-y-2">
            <QueueSectionHeader label="In progress" count={filteredOrders.length} />
            {filteredOrders.map((order) => (
              <ActivePickRow
                key={order.id}
                order={order}
                isMine={myOrderIds.has(order.id)}
                onOpen={
                  myOrderIds.has(order.id)
                    ? () => handleOpen(order.id, order)
                    : undefined
                }
              />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
