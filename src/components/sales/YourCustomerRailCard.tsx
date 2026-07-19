import type { Customer } from '../../types';
import {
  buildCustomerRailGlance,
  type CustomerRailBadgeIntent,
  type CollectionSnapshot,
} from '../../lib/receivables';
import { getCustomerCity } from '../../lib/customerDisplay';

function badgeClass(intent: CustomerRailBadgeIntent): string {
  switch (intent) {
    case 'positive':
      return 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border-[var(--border-positive)]';
    case 'negative':
      return 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] border-[var(--border-negative)]';
    case 'warning':
      return 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)] border-[var(--border-warning)]';
    default:
      return 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)] border-[var(--border-subtle)]';
  }
}

function statusDotClass(tone: ReturnType<typeof buildCustomerRailGlance>['tone']): string {
  switch (tone) {
    case 'clear':
      return 'bg-[var(--bg-positive)]';
    case 'critical':
    case 'late':
      return 'bg-[var(--bg-negative)]';
    case 'watch':
      return 'bg-[var(--bg-warning)]';
    default:
      return 'bg-[var(--content-quaternary)]';
  }
}

function customerContactLabel(customer: Customer | null, snapshot?: CollectionSnapshot): string | null {
  const contact =
    customer?.contact?.trim() ||
    customer?.salesman?.trim() ||
    snapshot?.customer.salesman?.trim() ||
    null;
  return contact || null;
}

export function customerRailMetaLine(
  customer: Customer | null,
  snapshot?: CollectionSnapshot,
): string | null {
  const city = (customer ? getCustomerCity(customer) : null) ?? snapshot?.customer.city ?? null;
  const contact = customerContactLabel(customer, snapshot);
  return [city, contact].filter(Boolean).join(' · ') || null;
}

interface YourCustomerRailCardProps {
  name: string;
  customer: Customer | null;
  snapshot?: CollectionSnapshot;
  snapshotLoading?: boolean;
  /** App-order frequency fallback while receivables hydrate. */
  orderCount?: number;
  isActive?: boolean;
  hasDuplicateName?: boolean;
  onClick: () => void;
}

/**
 * Horizontal “Your Customers” card — hierarchy for glance:
 * 1) name (identity)
 * 2) money/risk badge (decision)
 * 3) city · contact (context)
 * 4) bill count + oldest (evidence)
 */
export function YourCustomerRailCard({
  name,
  customer,
  snapshot,
  snapshotLoading = false,
  orderCount = 0,
  isActive = false,
  hasDuplicateName = false,
  onClick,
}: YourCustomerRailCardProps) {
  const glance = buildCustomerRailGlance(snapshot);
  const meta = customerRailMetaLine(customer, snapshot);
  const showDot = glance.status !== 'unknown';

  const countLabel = (() => {
    if (glance.billCount != null) {
      return `${glance.billCount} bill${glance.billCount === 1 ? '' : 's'}`;
    }
    if (snapshotLoading) return '…';
    if (orderCount > 0) return `${orderCount} order${orderCount === 1 ? '' : 's'}`;
    if (hasDuplicateName) return 'Choose branch';
    if (isActive) return 'Selected';
    return null;
  })();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      aria-label={[
        name,
        glance.primaryBadge?.label,
        glance.secondaryBadge?.label,
        meta,
      ]
        .filter(Boolean)
        .join(', ')}
      className={[
        'relative min-w-44 max-w-56 shrink-0 rounded-lg border px-3 py-3 text-left',
        'flex flex-col justify-between gap-1.5 transition-[transform,border-color,background-color] duration-[160ms] ease-out',
        'active:scale-[0.98]',
        isActive
          ? 'border-[var(--role-primary)] bg-[var(--role-primary-subtle)] shadow-sm'
          : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="mt-1 flex h-2 w-2 shrink-0 items-center" aria-hidden>
          {showDot ? (
            <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass(glance.tone)}`} />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--border-opaque)]" />
          )}
        </span>
        {countLabel ? (
          <span className="text-xs tabular-nums text-[var(--content-tertiary)]">
            {countLabel}
          </span>
        ) : null}
      </div>

      <div className="min-w-0">
        <p className="line-clamp-2 font-semibold leading-snug text-[var(--content-primary)]">
          {name}
        </p>
        {meta ? (
          <p className="mt-0.5 truncate text-xs text-[var(--content-tertiary)]">
            {meta}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {glance.primaryBadge ? (
          <span
            className={[
              'inline-flex max-w-full items-center rounded-full border px-1.5 py-0.5',
              'text-[10px] font-semibold tabular-nums leading-none',
              badgeClass(glance.primaryBadge.intent),
            ].join(' ')}
          >
            <span className="truncate">{glance.primaryBadge.label}</span>
          </span>
        ) : snapshotLoading ? (
          <span className="h-4 w-16 animate-pulse rounded-full bg-[var(--bg-tertiary)]" />
        ) : isActive ? (
          <span className="inline-flex items-center rounded-full border border-[var(--border-accent)] bg-[var(--role-primary-subtle)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--role-content)]">
            Ready
          </span>
        ) : null}

        {glance.secondaryBadge ? (
          <span
            className={[
              'inline-flex items-center rounded-full border px-1.5 py-0.5',
              'text-[10px] font-medium tabular-nums leading-none',
              badgeClass(glance.secondaryBadge.intent),
            ].join(' ')}
          >
            {glance.secondaryBadge.label}
          </span>
        ) : null}
      </div>
    </button>
  );
}
