import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, HourglassHigh } from '@phosphor-icons/react';
import { usePendingItems } from '../../hooks/usePendingItems';
import { Card, EmptyState, Skeleton } from '../../components/shared';
import { formatTimeAgo } from '../../utils/formatters';
import type { PendingItem } from '../../types';

function PendingCard({ item }: { item: PendingItem }) {
  const navigate = useNavigate();

  return (
    <Card
      pressable
      onClick={() => navigate(`/billing/review/${item.order_id}`)}
      className="min-h-[64px]"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-[var(--content-primary)] truncate">
              {item.customer_name}
            </p>
            <p className="text-xs text-[var(--content-tertiary)]">
              Order{' '}
              <span className="font-mono text-[var(--content-secondary)]">
                {item.order_number}
              </span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-[var(--content-tertiary)]">
              {formatTimeAgo(item.created_at)}
            </p>
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] text-[11px] font-semibold px-2 py-0.5">
              <HourglassHigh size={12} weight="bold" />
              Pending
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--content-primary)] truncate">
              {item.item_name}
            </p>
            <p className="text-xs text-[var(--content-secondary)] mt-0.5">
              Qty pending:{' '}
              <span className="font-mono font-semibold">
                {item.qty_pending}
              </span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] text-[var(--content-tertiary)] mb-1">
              {item.source === 'billing' ? 'From billing' : 'From picking'}
            </p>
            {item.created_by && (
              <p className="text-[11px] text-[var(--content-tertiary)]">
                by <span className="font-medium">{item.created_by}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function PendingPage() {
  const { data, isLoading, error } = usePendingItems({ status: 'pending' });

  const { totalCount, customerCount } = useMemo(() => {
    const list = data ?? [];
    const customerIds = new Set<string>();
    for (const pi of list) {
      customerIds.add(`${pi.customer_id ?? 'x'}:${pi.customer_name}`);
    }
    return {
      totalCount: list.length,
      customerCount: customerIds.size,
    };
  }, [data]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="p-4 lg:px-8 lg:py-6 max-w-6xl mx-auto">
        <h1 className="text-2xl lg:text-3xl font-bold text-[var(--content-primary)]">
          Pending Items
        </h1>
        <p className="text-sm lg:text-base text-[var(--content-secondary)] mt-1">
          Out-of-stock lines that need follow-up
        </p>

        <div className="mt-4 flex flex-wrap gap-3 text-sm text-[var(--content-secondary)]">
          <div className="inline-flex items-center gap-2 h-8 px-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-opaque)]">
            <Package size={16} className="text-[var(--content-tertiary)]" />
            <span className="font-mono font-semibold">
              {totalCount} pending item{totalCount === 1 ? '' : 's'}
            </span>
          </div>
          <div className="inline-flex items-center gap-2 h-8 px-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-opaque)]">
            <span className="w-2 h-2 rounded-full bg-[var(--content-quaternary)]" />
            <span className="font-mono font-semibold">
              {customerCount} customer{customerCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>

        <div className="mt-6 lg:mt-8">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton variant="card" count={5} />
            </div>
          ) : error ? (
            <p className="text-[var(--content-negative)]">Failed to load pending items</p>
          ) : !data || data.length === 0 ? (
            <EmptyState
              icon={HourglassHigh}
              title="No pending items"
              description="When billing or picking marks items as out of stock, they will appear here."
            />
          ) : (
            <div className="space-y-3 lg:space-y-4">
              {data.map((pi) => (
                <PendingCard key={pi.id} item={pi} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

