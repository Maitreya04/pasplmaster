import { type ReactNode, forwardRef } from 'react';
import { CaretDown } from '@phosphor-icons/react';

type SelectTriggerSize = 'md' | 'lg';

interface SelectTriggerProps {
  children: ReactNode;
  placeholder?: string;
  open?: boolean;
  onClick?: () => void;
  size?: SelectTriggerSize;
  className?: string;
  hasValue?: boolean;
}

const sizeStyles: Record<SelectTriggerSize, string> = {
  md: 'h-12 px-4 rounded-xl text-sm',
  lg: 'h-14 px-4 rounded-xl text-base',
};

export const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
  function SelectTrigger(
    {
      children,
      placeholder,
      open = false,
      onClick,
      size = 'lg',
      className = '',
      hasValue,
    },
    ref,
  ) {
    const showPlaceholder = !hasValue && placeholder;

    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        className={`
          w-full flex items-center justify-between gap-2
          bg-[var(--bg-tertiary)] text-left
          border border-[var(--border-subtle)]
          hover:border-[var(--content-quaternary)]
          transition-colors duration-150
          ${sizeStyles[size]}
          ${className}
        `}
      >
        {showPlaceholder ? (
          <span className="text-[var(--content-tertiary)] truncate">
            {placeholder}
          </span>
        ) : (
          <span className="text-[var(--content-primary)] font-medium truncate min-w-0">
            {children}
          </span>
        )}
        <CaretDown
          size={20}
          weight="bold"
          className={`
            text-[var(--content-tertiary)] shrink-0
            transition-transform duration-150
            ${open ? 'rotate-180' : ''}
          `}
        />
      </button>
    );
  },
);
