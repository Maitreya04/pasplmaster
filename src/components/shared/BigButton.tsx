import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { SpinnerGap } from '@phosphor-icons/react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface BigButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  children: ReactNode;
}

const baseStyles =
  'w-full flex items-center justify-center gap-2 font-semibold text-base transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-40';

function getVariantStyles(variant: Variant): string {
  switch (variant) {
    case 'primary':
      return 'h-14 bg-[var(--bg-accent)] text-[var(--content-on-color)] rounded-xl hover:opacity-90 active:opacity-80';
    case 'secondary':
      return 'h-12 bg-[var(--bg-tertiary)] text-[var(--content-secondary)] rounded-xl hover:opacity-90 active:opacity-80';
    case 'danger':
      return 'h-12 bg-transparent text-[var(--content-negative)] font-medium rounded-xl hover:opacity-80 active:opacity-70';
    case 'ghost':
      return 'h-12 bg-transparent text-[var(--content-secondary)] rounded-xl hover:text-[var(--content-primary)]';
  }
}

export function BigButton({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: BigButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      data-inverse-primary={variant === 'primary' ? '' : undefined}
      className={`${baseStyles} ${getVariantStyles(variant)} ${className}`}
      {...rest}
    >
      {loading ? (
        <SpinnerGap size={20} weight="regular" className="animate-spin" />
      ) : (
        children
      )}
    </button>
  );
}
