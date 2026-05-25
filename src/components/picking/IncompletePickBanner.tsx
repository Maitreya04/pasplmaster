import { ArrowRight, CheckCircle } from '@phosphor-icons/react';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import { pickProgressFromPreview } from '../../lib/picking/pickQueueDisplay';

interface IncompletePickBannerProps {
  order: OrderWithClaimInfo;
  onOpen: () => void;
}

export function IncompletePickBanner({
  order,
  onOpen,
}: IncompletePickBannerProps): React.JSX.Element {
  const progress = pickProgressFromPreview(order.order_items_preview);
  const allLinesDone = progress.total > 0 && progress.done >= progress.total;

  return (
    <div className="sticky top-11 z-30 border-b border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 py-3">
      <div className="flex items-start gap-2.5">
        {allLinesDone ? (
          <CheckCircle
            size={18}
            weight="fill"
            className="mt-0.5 shrink-0 text-[var(--content-positive)]"
          />
        ) : (
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--bg-warning)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[var(--content-primary)] leading-tight">
            Did you complete this pick?
          </p>
          <p className="mt-0.5 truncate text-[12px] text-[var(--content-secondary)]">
            {order.order_number} · {order.customer_name}
          </p>
          {allLinesDone ? (
            <p className="mt-1 text-[11px] text-[var(--content-positive)]">
              All lines are picked — open and tap Complete.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-[var(--content-tertiary)]">
              {order.transport_name ?? 'No transport'}
              {progress.total > 0 && (
                <>
                  {' '}
                  · {progress.done}/{progress.total} lines
                </>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--bg-warning)] px-2.5 py-1.5 text-xs font-semibold text-[var(--content-primary)] active:scale-[0.98]"
        >
          Open pick
          <ArrowRight size={14} weight="bold" />
        </button>
      </div>
    </div>
  );
}
