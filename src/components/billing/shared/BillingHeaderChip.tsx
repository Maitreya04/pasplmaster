import type { Icon } from '@phosphor-icons/react';
import { BillingFigure } from './BillingFigure';

type HeaderChipTone = 'accent' | 'positive' | 'warning';

interface BillingHeaderChipProps {
  icon: Icon;
  label: string;
  count: number;
  tone: HeaderChipTone;
  /** Full phrase for hover / screen readers when label is abbreviated. */
  title?: string;
  /** Icon + count only — for tight dock rows. */
  compact?: boolean;
  onClick?: () => void;
}

export function BillingHeaderChip({
  icon: IconComponent,
  label,
  count,
  tone,
  title,
  compact = false,
  onClick,
}: BillingHeaderChipProps): React.JSX.Element | null {
  if (count <= 0) return null;

  const className = [
    'busy-entry-chip',
    'billing-header-chip',
    compact ? 'billing-header-chip--compact' : '',
    `busy-entry-chip--${tone}`,
    onClick ? 'busy-entry-chip--interactive' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const accessibleTitle = title ?? label;

  const content = (
    <>
      <span className="billing-header-chip__icon" aria-hidden>
        <IconComponent size={compact ? 13 : 14} weight="bold" />
      </span>
      {compact ? (
        <BillingFigure value={count} kind="integer" size="xs" className="billing-header-chip__count" />
      ) : (
        <>
          <span className="billing-header-chip__label">{label}</span>
          <BillingFigure value={count} kind="integer" size="xs" className="billing-header-chip__count" />
        </>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        title={accessibleTitle}
        aria-label={`${accessibleTitle} (${count.toLocaleString('en-IN')})`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={className} title={accessibleTitle}>
      {content}
    </span>
  );
}
