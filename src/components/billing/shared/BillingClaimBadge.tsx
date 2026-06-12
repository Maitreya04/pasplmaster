import { formatTimeAgo } from '../../../utils/formatters';
import type { OrderWithClaimInfo } from '../../../hooks/useClaimableOrders';
import { handoffFirstName } from '../../../lib/billing/orderHandoffFromEvents';

interface BillingClaimBadgeProps {
  order: Pick<OrderWithClaimInfo, 'claim_info' | 'is_mine'>;
  /** When true, use "Finalising" label for another person's fresh claim. */
  postPick?: boolean;
}

export function BillingClaimBadge({
  order,
  postPick = false,
}: BillingClaimBadgeProps): React.JSX.Element | null {
  const claim = order.claim_info;
  if (!claim) return null;

  const firstName = handoffFirstName(claim.claimed_by_name);

  let label: string;
  let className: string;

  if (claim.is_stale) {
    label = `Stale · ${firstName} — tap to take over`;
    className =
      'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] font-semibold';
  } else if (order.is_mine) {
    label = 'Claimed by you';
    className =
      'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] font-semibold';
  } else if (postPick) {
    label = `Finalising · ${firstName}`;
    className = 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]';
  } else {
    label = `Processing by ${firstName}`;
    className = 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]';
  }

  return (
    <div
      className={`text-xs px-2 py-1 rounded inline-flex w-max ${className}`}
      title={
        claim.is_stale
          ? `Last active ${formatTimeAgo(claim.last_heartbeat_at)}`
          : undefined
      }
    >
      {label}
    </div>
  );
}
