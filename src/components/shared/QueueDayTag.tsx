import type { JSX } from 'react';
import { isLateBilled, isLateToBill } from '../../lib/queueDayBuckets';
import type { Order } from '../../types';

type QueueDayTagVariant = 'late_billed' | 'late_to_bill';

function tagCopy(variant: QueueDayTagVariant): string {
  return variant === 'late_billed' ? 'Late billed' : 'Late to bill';
}

export function QueueDayTag({
  order,
  variant,
  className = '',
}: {
  order: Order;
  variant: QueueDayTagVariant;
  className?: string;
}): JSX.Element | null {
  const show =
    variant === 'late_billed' ? isLateBilled(order) : isLateToBill(order);
  if (!show) return null;

  const isBilling = variant === 'late_to_bill';

  return (
    <span
      className={`inline-flex items-center font-ds-micro uppercase font-bold tracking-wide px-2 py-0.5 rounded border shrink-0 ${
        isBilling
          ? 'text-[var(--content-warning)] bg-[var(--bg-warning-subtle)] border-[var(--border-warning)]'
          : 'text-[var(--content-accent)] bg-[var(--bg-accent-subtle)] border-[var(--border-accent)]'
      } ${className}`}
    >
      {tagCopy(variant)}
    </span>
  );
}
