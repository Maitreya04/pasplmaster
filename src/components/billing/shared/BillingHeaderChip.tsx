import type { Icon } from '@phosphor-icons/react';

type HeaderChipTone = 'accent' | 'positive' | 'warning';

interface BillingHeaderChipProps {
  icon: Icon;
  label: string;
  count: number;
  tone: HeaderChipTone;
  onClick?: () => void;
}

function formatCount(value: number): string {
  return value.toLocaleString('en-IN');
}

export function BillingHeaderChip({
  icon: IconComponent,
  label,
  count,
  tone,
  onClick,
}: BillingHeaderChipProps): React.JSX.Element | null {
  if (count <= 0) return null;

  const className = [
    'busy-entry-chip',
    'billing-header-chip',
    `busy-entry-chip--${tone}`,
    onClick ? 'busy-entry-chip--interactive' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <span className="billing-header-chip__icon" aria-hidden>
        <IconComponent size={14} weight="bold" />
      </span>
      <span className="billing-header-chip__label">{label}</span>
      <span className="billing-header-chip__count tabular-nums">{formatCount(count)}</span>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <span className={className}>{content}</span>;
}
