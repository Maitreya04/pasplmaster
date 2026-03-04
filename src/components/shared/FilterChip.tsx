import { X } from '@phosphor-icons/react';

interface FilterChipProps {
  label: string;
  selected?: boolean;
  onClick: () => void;
  count?: number;
  /** Show remove icon when selected; if onRemove is set, icon clears and chip tap does onClick (e.g. open sheet) */
  removable?: boolean;
  onRemove?: () => void;
}

export function FilterChip({
  label,
  selected = false,
  onClick,
  count,
  removable,
  onRemove,
}: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5
        h-8 px-3 rounded-full text-sm font-medium
        border transition-[background,color,border-color] duration-150 whitespace-nowrap shrink-0
        ${
          selected
            ? 'bg-[var(--role-primary-subtle)] text-[var(--role-content)] border-[color-mix(in_srgb,var(--role-primary)_22%,transparent)]'
            : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)] border-transparent hover:text-[var(--content-primary)] hover:bg-[var(--border-subtle)]'
        }
      `}
    >
      {label}
      {count !== undefined && (
        <span className={`font-mono text-xs ${selected ? 'opacity-70' : 'text-[var(--content-quaternary)]'}`}>
          {count}
        </span>
      )}
      {selected && removable && (
        onRemove ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onRemove();
              }
            }}
            className="ml-0.5 p-0.5 -m-0.5 rounded hover:bg-[var(--bg-row-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--role-primary)] focus-visible:ring-inset cursor-pointer"
            aria-label="Remove filter"
          >
            <X size={14} weight="bold" className="text-current" aria-hidden />
          </span>
        ) : (
          <X size={14} weight="bold" className="shrink-0 opacity-70" aria-hidden />
        )
      )}
    </button>
  );
}
