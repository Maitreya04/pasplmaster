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
        ${pressable ? 'cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors duration-150' : ''}
        ${className}
      `}
      {...rest}
    >
      {children}
    </div>
  );
}
