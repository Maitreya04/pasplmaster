import { useState, useEffect, type ReactElement } from 'react';
import type { OrderWithClaimInfo } from '../../../hooks/useClaimableOrders';
import { formatCurrency, formatTimeAgo } from '../../../utils/formatters';

interface QueueViewProps {
  queue: OrderWithClaimInfo[];
  isLoading: boolean;
  onSelect: (orderId: number) => void;
}

export function QueueView({ queue, isLoading, onSelect }: QueueViewProps): ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Clamp selected index when queue changes
  useEffect(() => {
    if (selectedIndex >= queue.length) {
      setSelectedIndex(Math.max(0, queue.length - 1));
    }
  }, [queue.length, selectedIndex]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, queue.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      }
      if (e.key === 'Enter' && queue.length > 0) {
        e.preventDefault();
        const order = queue[selectedIndex];
        // Don't allow selecting orders claimed by others
        if (order && (!order.claim_info || order.is_mine)) {
          onSelect(order.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [queue, selectedIndex, onSelect]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] p-4 sm:p-8">
        <div className="max-w-2xl mx-auto">
          <div className="h-8 w-48 bg-[var(--bg-tertiary)] rounded-lg animate-pulse mb-8" />
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-[var(--bg-secondary)] rounded-2xl mb-3 animate-pulse border border-[var(--border-subtle)]" />
          ))}
        </div>
      </div>
    );
  }

  const availableCount = queue.filter(o => !o.claim_info || o.is_mine).length;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-4 sm:p-8">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-[var(--content-primary)]">
            Billing Queue
          </h1>
          {availableCount > 0 && (
            <span className="text-sm font-bold text-[var(--content-secondary)] bg-[var(--bg-tertiary)] border border-[var(--border-opaque)] px-3 py-1 rounded-full font-mono">
              {availableCount}
            </span>
          )}
        </div>

        {/* Empty state */}
        {queue.length === 0 && (
          <div className="text-center py-20">
            <p className="text-lg font-semibold text-[var(--content-secondary)] mb-2">
              No orders waiting
            </p>
            <p className="text-sm text-[var(--content-quaternary)]">
              New orders will appear here when sales submits them.
            </p>
          </div>
        )}

        {/* Order cards */}
        <div className="space-y-3">
          {queue.map((order, index) => {
            const isSelected = index === selectedIndex;
            const isClaimed = !!order.claim_info && !order.is_mine;
            const isUrgent = order.priority === 'urgent';

            return (
              <button
                key={order.id}
                onClick={() => {
                  if (!isClaimed) {
                    setSelectedIndex(index);
                    onSelect(order.id);
                  }
                }}
                disabled={isClaimed}
                className={`w-full text-left p-5 rounded-2xl border-2 transition-all ${
                  isClaimed
                    ? 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)] border-[var(--border-subtle)]'
                    : isSelected
                      ? 'bg-[var(--bg-secondary)] border-[var(--role-primary)] shadow-sm'
                      : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-opaque)]'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {isUrgent && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--bg-negative)] text-white text-xs font-bold uppercase tracking-wide">
                          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                          Urgent
                        </span>
                      )}
                      <h3 className={`text-lg font-bold truncate ${isClaimed ? 'text-[var(--content-tertiary)]' : 'text-[var(--content-primary)]'}`}>
                        {order.customer_name}
                      </h3>
                    </div>
                    <p className={`text-sm font-medium ${isClaimed ? 'text-[var(--content-quaternary)]' : 'text-[var(--content-secondary)]'}`}>
                      {order.order_number}
                      {order.customer_city && <span> · {order.customer_city}</span>}
                      {order.salesperson_name && <span> · {order.salesperson_name}</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-mono font-bold ${isClaimed ? 'text-[var(--content-quaternary)]' : 'text-[var(--content-primary)]'}`}>
                      {formatCurrency(order.total_value)}
                    </p>
                    <p className="text-xs text-[var(--content-tertiary)] mt-1">
                      {order.item_count} items · {formatTimeAgo(order.created_at)}
                    </p>
                  </div>
                </div>

                {isClaimed && (
                  <p className="text-xs font-medium text-[var(--content-quaternary)] mt-2 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--content-quaternary)]" />
                    Being billed by {order.claim_info!.claimed_by_name} · started {formatTimeAgo(order.claim_info!.claimed_at)}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* Keyboard hint */}
        {queue.length > 0 && (
          <p className="text-center text-xs text-[var(--content-quaternary)] mt-8">
            ↑↓ navigate · Enter to start billing
          </p>
        )}

      </div>
    </div>
  );
}
