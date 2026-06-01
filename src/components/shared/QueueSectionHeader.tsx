interface QueueSectionHeaderProps {
  label: string;
  count: number;
  description?: string;
  className?: string;
  showWhenEmpty?: boolean;
  tone?: 'default' | 'danger' | 'info';
  rightSlot?: React.ReactNode;
  sticky?: boolean;
  /** Linear-style: sentence case, no count pill */
  variant?: 'default' | 'subtle' | 'divider';
}

const LABEL_TONE: Record<NonNullable<QueueSectionHeaderProps['tone']>, string> = {
  default: 'text-[var(--content-tertiary)]',
  danger: 'text-[var(--content-negative)]',
  info: 'text-[var(--content-accent)]',
};

export function QueueSectionHeader({
  label,
  count,
  description,
  className = '',
  showWhenEmpty = false,
  tone = 'default',
  rightSlot,
  sticky = false,
  variant = 'default',
}: QueueSectionHeaderProps): React.JSX.Element | null {
  if (count === 0 && !showWhenEmpty) return null;

  if (variant === 'divider') {
    return (
      <div
        className={`flex items-center gap-2.5 ${sticky ? 'sticky top-0 z-10 bg-[var(--bg-secondary)]' : ''} ${className}`}
        style={{ padding: '12px 16px 6px' }}
        role="separator"
        aria-label={`${label}${count > 0 ? `, ${count}` : ''}`}
      >
        <span
          className="flex-1"
          style={{ height: '0.5px', background: 'var(--border-opaque)' }}
          aria-hidden
        />
        <span
          className="shrink-0 uppercase tracking-[0.06em] font-ds-label-size font-medium text-[var(--content-tertiary)]"
        >
          {label}
          {count > 0 ? ` ${count}` : ''}
        </span>
        {description && (
          <span className="font-ds-label-size text-[var(--content-tertiary)]">
            {description}
          </span>
        )}
        <span
          className="flex-1"
          style={{ height: '0.5px', background: 'var(--border-opaque)' }}
          aria-hidden
        />
      </div>
    );
  }

  if (variant === 'subtle') {
    return (
      <div
        className={`py-2 ${sticky ? 'sticky top-0 z-10 bg-[var(--bg-secondary)]' : ''} ${className}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <span
              className={`font-ds-body-size font-semibold ${LABEL_TONE[tone]}`}
            >
              {label}
            </span>
            <span className="font-ds-body-size font-semibold tabular-nums text-[var(--content-primary)]">
              {count}
            </span>
          </div>
          {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
        </div>
        {description ? (
          <p className="mt-0.5 font-ds-caption-size text-[var(--content-quaternary)] leading-snug">
            {description}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`pb-2 ${sticky ? 'sticky top-0 z-10 bg-[var(--bg-primary)] py-2 -mx-1 px-1' : ''} ${className}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`text-xs font-semibold uppercase tracking-wider ${LABEL_TONE[tone]}`}
        >
          {label}
        </span>
        <span className="text-xs font-mono font-semibold text-[var(--content-quaternary)] bg-[var(--bg-tertiary)] rounded-full px-2 py-0.5">
          {count}
        </span>
        {rightSlot ? <div className="ml-auto shrink-0">{rightSlot}</div> : null}
      </div>
      {description && (
        <p className="mt-1 text-xs text-[var(--content-quaternary)] leading-snug">
          {description}
        </p>
      )}
    </div>
  );
}
