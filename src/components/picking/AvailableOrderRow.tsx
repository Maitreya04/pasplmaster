import { Truck, SpinnerGap } from '@phosphor-icons/react';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import { PickQueuePartyBlock } from './PickQueuePartyBlock';

interface AvailableOrderRowProps {
  order: OrderWithClaimInfo;
  onClaim: () => void;
  claiming: boolean;
}

export function AvailableOrderRow({
  order,
  onClaim,
  claiming,
}: AvailableOrderRowProps): React.JSX.Element {
  const isUrgent = order.priority === 'urgent';
  const isStale = Boolean(order.claim_info?.is_stale);

  return (
    <button
      type="button"
      onClick={onClaim}
      disabled={claiming}
      className={`
        relative flex w-full items-start gap-3 rounded-2xl border p-4 text-left
        transition-all duration-150 hover:bg-[var(--bg-tertiary)]
        active:scale-[0.99] disabled:cursor-wait
        ${
          isUrgent
            ? 'border-[var(--border-negative)] border-l-4 bg-[var(--bg-negative-subtle)]'
            : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
        }
      `}
    >
      <div
        className={`
          mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl
          ${
            isUrgent
              ? 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]'
              : 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
          }
        `}
        aria-hidden="true"
      >
        <Truck size={20} weight="duotone" />
      </div>

      <PickQueuePartyBlock order={order} />

      {isStale && (
        <span className="absolute bottom-3 right-3 font-ds-micro uppercase font-bold text-[var(--content-warning)] bg-[var(--bg-warning-subtle)] px-2 py-0.5 rounded border border-[var(--border-warning)]">
          Stale (Takeover)
        </span>
      )}

      {claiming && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-[var(--bg-primary)]/60">
          <SpinnerGap size={24} className="animate-spin text-[var(--content-accent)]" />
        </div>
      )}
    </button>
  );
}
