import { UserCheck } from '@phosphor-icons/react';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import { PickQueuePartyBlock } from './PickQueuePartyBlock';

interface AssignedOrderRowProps {
  order: OrderWithClaimInfo;
  onOpen: () => void;
  disabled?: boolean;
}

export function AssignedOrderRow({
  order,
  onOpen,
  disabled = false,
}: AssignedOrderRowProps): React.JSX.Element {
  const isUrgent = order.priority === 'urgent';
  const isStale = Boolean(order.claim_info?.is_stale);

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className={`
        relative flex w-full items-start gap-3 rounded-2xl border p-4 text-left
        transition-all duration-150 hover:bg-[var(--bg-tertiary)] active:scale-[0.99]
        disabled:cursor-not-allowed disabled:opacity-50
        ${
          isUrgent
            ? 'border-[var(--border-accent)] border-l-4 bg-[var(--bg-accent-subtle)]'
            : 'border-[var(--border-accent)] bg-[var(--bg-secondary)]'
        }
      `}
    >
      <div
        className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]"
        aria-hidden="true"
      >
        <UserCheck size={20} weight="duotone" />
      </div>

      <PickQueuePartyBlock order={order} />

      <span className="absolute bottom-3 right-3 flex flex-wrap justify-end gap-1">
        {isStale && (
          <span className="rounded-full border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--content-warning)]">
            Stale
          </span>
        )}
        <span className="rounded-full bg-[var(--bg-accent-subtle)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--content-accent)]">
          Assigned
        </span>
      </span>
    </button>
  );
}
