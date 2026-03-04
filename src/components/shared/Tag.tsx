import { type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';

type TagColor = 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink'
  | 'accent' | 'positive' | 'warning' | 'negative';
type TagVariant = 'filled' | 'light' | 'outlined';
type TagSize = 'sm' | 'md';

interface TagProps {
  children: ReactNode;
  color?: TagColor;
  variant?: TagVariant;
  size?: TagSize;
  icon?: ReactNode;
  onClose?: () => void;
  className?: string;
}

const colorStyles: Record<TagColor, Record<TagVariant, string>> = {
  accent: {
    filled: 'bg-[var(--bg-accent)] text-[var(--content-on-color)]',
    light: 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]',
    outlined: 'border border-[var(--border-accent)] text-[var(--content-accent)]',
  },
  positive: {
    filled: 'bg-[var(--bg-positive)] text-[var(--content-on-color)]',
    light: 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]',
    outlined: 'border border-[var(--border-positive)] text-[var(--content-positive)]',
  },
  warning: {
    filled: 'bg-[var(--bg-warning)] text-[var(--content-on-color)]',
    light: 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]',
    outlined: 'border border-[var(--border-warning)] text-[var(--content-warning)]',
  },
  negative: {
    filled: 'bg-[var(--bg-negative)] text-[var(--content-on-color)]',
    light: 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]',
    outlined: 'border border-[var(--border-negative)] text-[var(--content-negative)]',
  },
  gray: {
    filled: 'bg-[var(--bg-inverse-secondary)] text-[var(--content-inverse-primary)]',
    light: 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]',
    outlined: 'border border-[var(--border-opaque)] text-[var(--content-secondary)]',
  },
  blue: {
    filled: 'bg-[var(--bg-accent)] text-[var(--content-on-color)]',
    light: 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]',
    outlined: 'border border-[var(--border-accent)] text-[var(--content-accent)]',
  },
  green: {
    filled: 'bg-[var(--bg-positive)] text-[var(--content-on-color)]',
    light: 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]',
    outlined: 'border border-[var(--border-positive)] text-[var(--content-positive)]',
  },
  red: {
    filled: 'bg-[var(--bg-negative)] text-[var(--content-on-color)]',
    light: 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]',
    outlined: 'border border-[var(--border-negative)] text-[var(--content-negative)]',
  },
  orange: {
    filled: 'bg-[var(--bg-warning)] text-[var(--content-on-color)]',
    light: 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]',
    outlined: 'border border-[var(--border-warning)] text-[var(--content-warning)]',
  },
  yellow: {
    filled: 'bg-[var(--bg-warning)] text-[var(--content-on-color)]',
    light: 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]',
    outlined: 'border border-[var(--border-warning)] text-[var(--content-warning)]',
  },
  purple: {
    filled: 'bg-[var(--role-primary)] text-[var(--content-on-color)]',
    light: 'bg-[var(--role-primary-subtle)] text-[var(--role-content)]',
    outlined: 'border border-[color-mix(in_srgb,var(--role-primary)_30%,transparent)] text-[var(--role-content)]',
  },
  pink: {
    filled: 'bg-[var(--bg-negative)] text-[var(--content-on-color)]',
    light: 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]',
    outlined: 'border border-[var(--border-negative)] text-[var(--content-negative)]',
  },
};

const sizeStyles: Record<TagSize, string> = {
  sm: 'text-xs h-5 px-2 gap-1',
  md: 'text-sm h-6 px-3 gap-1.5',
};

const closeSize: Record<TagSize, number> = { sm: 12, md: 14 };
const iconSize: Record<TagSize, number> = { sm: 12, md: 14 };

export function Tag({
  children,
  color = 'gray',
  variant = 'light',
  size = 'sm',
  icon,
  onClose,
  className = '',
}: TagProps) {
  return (
    <span
      className={`
        inline-flex items-center rounded-full font-medium whitespace-nowrap shrink-0
        ${sizeStyles[size]}
        ${colorStyles[color][variant]}
        ${className}
      `}
    >
      {icon && <span className="shrink-0 flex items-center" style={{ fontSize: iconSize[size] }}>{icon}</span>}
      {children}
      {onClose && (
        <button
          onClick={onClose}
          className="shrink-0 flex items-center rounded-full opacity-60 hover:opacity-100 transition-opacity"
          aria-label="Remove"
        >
          <X size={closeSize[size]} weight="bold" />
        </button>
      )}
    </span>
  );
}

export type { TagColor, TagVariant, TagSize };
