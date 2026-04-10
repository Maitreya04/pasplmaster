import type { ReactElement } from 'react';
import { Lightning } from '@phosphor-icons/react';
import type { OrderWithClaimInfo } from '../../../hooks/useClaimableOrders';

interface OrientViewProps {
  queue: OrderWithClaimInfo[];
  staleCount: number;
  totalWaiting: number;
  onStart: () => void;
  isLoading: boolean;
}

export function OrientView({ queue, totalWaiting, onStart, isLoading }: OrientViewProps): ReactElement {
  const urgentCount = queue.filter(o => o.priority === 'urgent').length;
  const nextOrder = queue[0];

  return (
    <div className="density-compact flex flex-col items-center justify-center min-h-[80vh] p-6 max-w-xl mx-auto text-center animate-slide-up">
      <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--bg-accent)] mb-8 shadow-lg">
        <Lightning size={32} weight="fill" className="text-white" />
      </div>

      <h1 className="text-6xl font-bold text-[var(--content-primary)] tracking-tight mb-2">
        {isLoading ? '...' : totalWaiting}
      </h1>
      <p className="text-lg font-medium text-[var(--content-secondary)] mb-6">
        orders waiting
      </p>

      {urgentCount > 0 && (
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] rounded-full text-sm font-bold tracking-widest uppercase mb-12">
          <span className="w-2 h-2 rounded-full bg-[var(--bg-negative)] animate-pulse" />
          {urgentCount} URGENT
        </div>
      )}

      {/* spacer if no urgent to keep layout stable */}
      {urgentCount === 0 && <div className="h-12 w-full mb-12" />} 

      <button
        type="button"
        onClick={onStart}
        disabled={isLoading || totalWaiting === 0}
        className="w-full max-w-sm h-16 rounded-2xl bg-[var(--role-primary)] text-white text-lg font-bold flex items-center justify-center gap-3 hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_8px_16px_rgba(37,99,235,0.2)]"
      >
        <span>▶ Start Next Order</span>
      </button>

      {nextOrder && (
        <div className="mt-12 text-sm text-[var(--content-tertiary)] flex flex-col gap-2">
          <p className="font-semibold text-[var(--content-secondary)]">
            Next: {nextOrder.customer_name} · {nextOrder.item_count} items {nextOrder.priority === 'urgent' && '· 🔴 URGENT'}
          </p>
          {queue[1] && <p>Then: {queue[1].customer_name} · {queue[1].item_count} items</p>}
          {queue[2] && <p>Then: {queue[2].customer_name} · {queue[2].item_count} items</p>}
        </div>
      )}
    </div>
  );
}
