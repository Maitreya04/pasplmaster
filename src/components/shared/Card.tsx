import { type ReactNode, type HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  pressable?: boolean;
  children: ReactNode;
}

export function Card({
  pressable = false,
  children,
  className = '',
  onClick,
  ...rest
}: CardProps) {
  return (
    <div
      role={pressable ? 'button' : undefined}
      tabIndex={pressable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        pressable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.(e as unknown as React.MouseEvent<HTMLDivElement>);
              }
            }
          : undefined
      }
      className={`
        rounded-2xl p-5
        bg-[var(--bg-secondary)]
        border border-[var(--border-subtle)]
        shadow-[var(--shadow-card)]
        ${pressable
          ? 'cursor-pointer transition-[box-shadow,border-color,background] duration-[150ms] ease-out hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-opaque)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--role-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]'
          : ''}
        ${className}
      `}
      {...rest}
    >
      {children}
    </div>
  );
}
