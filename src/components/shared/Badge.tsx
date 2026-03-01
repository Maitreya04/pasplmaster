import { type ReactNode } from 'react';

type BadgeColor = 'accent' | 'positive' | 'warning' | 'negative';
type BadgeVariant = 'count' | 'dot';

interface BadgeProps {
  variant?: BadgeVariant;
  color?: BadgeColor;
  count?: number;
  maxCount?: number;
  children?: ReactNode;
  overlap?: boolean;
  className?: string;
}

const colorMap: Record<BadgeColor, { filled: string; dot: string }> = {
  accent: {
    filled: 'bg-[var(--bg-accent)] text-[var(--content-on-color)]',
    dot: 'bg-[var(--bg-accent)]',
  },
  positive: {
    filled: 'bg-[var(--bg-positive)] text-[var(--content-on-color)]',
    dot: 'bg-[var(--bg-positive)]',
  },
  warning: {
    filled: 'bg-[var(--bg-warning)] text-black',
    dot: 'bg-[var(--bg-warning)]',
  },
  negative: {
    filled: 'bg-[var(--bg-negative)] text-[var(--content-on-color)]',
    dot: 'bg-[var(--bg-negative)]',
  },
};

function BadgeContent({
  variant = 'count',
  color = 'accent',
  count,
  maxCount = 99,
  className = '',
}: Omit<BadgeProps, 'children' | 'overlap'>) {
  const styles = colorMap[color];

  if (variant === 'dot') {
    return (
      <span className={`block w-2 h-2 rounded-full ${styles.dot} ${className}`} />
    );
  }

  const displayCount = count !== undefined && count > maxCount ? `${maxCount}+` : count;

  return (
    <span
      className={`
        inline-flex items-center justify-center
        min-w-[18px] h-[18px] px-1 rounded-full
        text-[11px] font-bold leading-none
        ${styles.filled}
        ${className}
      `}
    >
      {displayCount}
    </span>
  );
}

export function Badge({
  variant = 'count',
  color = 'accent',
  count,
  maxCount = 99,
  children,
  overlap = false,
  className = '',
}: BadgeProps) {
  const badge = (
    <BadgeContent
      variant={variant}
      color={color}
      count={count}
      maxCount={maxCount}
    />
  );

  if (!children) return <span className={className}>{badge}</span>;

  return (
    <span className={`relative inline-flex ${className}`}>
      {children}
      <span
        className={`
          absolute
          ${overlap ? '-top-1 -right-1' : '-top-0.5 -right-0.5'}
          ${variant === 'dot' ? '-top-0.5 -right-0.5' : ''}
        `}
      >
        {badge}
      </span>
    </span>
  );
}

export type { BadgeColor, BadgeVariant };
