import { type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';

type TagColor = 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink';
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
  gray: {
    filled: 'bg-gray-600 text-white',
    light: 'bg-gray-500/10 text-gray-600 dark:bg-gray-400/15 dark:text-gray-300',
    outlined: 'border border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-300',
  },
  red: {
    filled: 'bg-red-600 text-white',
    light: 'bg-red-500/10 text-red-600 dark:bg-red-400/15 dark:text-red-400',
    outlined: 'border border-red-300 text-red-600 dark:border-red-500/40 dark:text-red-400',
  },
  orange: {
    filled: 'bg-orange-500 text-white',
    light: 'bg-orange-500/10 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400',
    outlined: 'border border-orange-300 text-orange-600 dark:border-orange-500/40 dark:text-orange-400',
  },
  yellow: {
    filled: 'bg-yellow-500 text-black',
    light: 'bg-yellow-500/10 text-yellow-700 dark:bg-yellow-400/15 dark:text-yellow-400',
    outlined: 'border border-yellow-400 text-yellow-700 dark:border-yellow-500/40 dark:text-yellow-400',
  },
  green: {
    filled: 'bg-green-600 text-white',
    light: 'bg-green-500/10 text-green-600 dark:bg-green-400/15 dark:text-green-400',
    outlined: 'border border-green-300 text-green-600 dark:border-green-500/40 dark:text-green-400',
  },
  blue: {
    filled: 'bg-blue-600 text-white',
    light: 'bg-blue-500/10 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400',
    outlined: 'border border-blue-300 text-blue-600 dark:border-blue-500/40 dark:text-blue-400',
  },
  purple: {
    filled: 'bg-purple-600 text-white',
    light: 'bg-purple-500/10 text-purple-600 dark:bg-purple-400/15 dark:text-purple-400',
    outlined: 'border border-purple-300 text-purple-600 dark:border-purple-500/40 dark:text-purple-400',
  },
  pink: {
    filled: 'bg-pink-600 text-white',
    light: 'bg-pink-500/10 text-pink-600 dark:bg-pink-400/15 dark:text-pink-400',
    outlined: 'border border-pink-300 text-pink-600 dark:border-pink-500/40 dark:text-pink-400',
  },
};

const sizeStyles: Record<TagSize, string> = {
  sm: 'text-xs px-2 py-0.5 gap-1',
  md: 'text-sm px-2.5 py-1 gap-1.5',
};

const closeSize: Record<TagSize, number> = {
  sm: 12,
  md: 14,
};

const iconSize: Record<TagSize, number> = {
  sm: 12,
  md: 14,
};

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
