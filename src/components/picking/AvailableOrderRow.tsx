import { Truck } from '@phosphor-icons/react';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import { PickQueuePartyBlock } from './PickQueuePartyBlock';

interface AvailableOrderRowProps {
  order: OrderWithClaimInfo;
  onOpen: () => void;
  disabled?: boolean;
}

export function AvailableOrderRow({
  order,
  onOpen,
  disabled = false,
}: AvailableOrderRowProps): React.JSX.Element {
  const isUrgent = order.priority === 'urgent';
  const isStale = Boolean(order.claim_info?.is_stale);

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className={`
        relative flex w-full items-start gap-3 rounded-2xl border p-4 text-left
        transition-all duration-150 hover:bg-[var(--bg-tertiary)]
        active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50
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
              : 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]'
          }
        `}
        aria-hidden="true"
      >
        <Truck size={20} weight="duotone" />
      </div>

      <PickQueuePartyBlock order={order} />

      <span className="absolute bottom-3 right-3 rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--content-tertiary)]">
        Unassigned
      </span>

      {isStale && (
        <span className="absolute top-3 right-3 font-ds-micro uppercase font-bold text-[var(--content-warning)] bg-[var(--bg-warning-subtle)] px-2 py-0.5 rounded border border-[var(--border-warning)]">
          Stale
        </span>
      )}
    </button>
  );
}
