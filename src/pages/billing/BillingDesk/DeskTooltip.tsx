import type { ReactElement, ReactNode } from 'react';

interface DeskTooltipProps {
  label: string;
  /** Preferred side for the tooltip bubble. */
  side?: 'top' | 'bottom';
  children: ReactNode;
  className?: string;
}

export function DeskTooltip({
  label,
  side = 'top',
  children,
  className = '',
}: DeskTooltipProps): ReactElement {
  const positionClass =
    side === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-1.5'
      : 'top-full left-1/2 -translate-x-1/2 mt-1.5';

  return (
    <span className={`relative inline-flex group/dtip ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute ${positionClass} z-30 w-max max-w-[220px] rounded-md border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-2 py-1 text-[10px] leading-snug text-[var(--content-secondary)] shadow-md opacity-0 scale-95 group-hover/dtip:opacity-100 group-hover/dtip:scale-100 group-focus-within/dtip:opacity-100 group-focus-within/dtip:scale-100 transition-all duration-150 delay-300 group-hover/dtip:delay-500`}
      >
        {label}
      </span>
    </span>
  );
}
