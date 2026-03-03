interface FilterChipProps {
  label: string;
  selected?: boolean;
  onClick: () => void;
  count?: number;
  /** Show ✕ when selected; if onRemove is set, ✕ clears and chip tap does onClick (e.g. open sheet) */
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
        px-3 py-1.5 rounded-lg text-sm font-medium
        transition-colors duration-150 whitespace-nowrap shrink-0
        ${
          selected
            ? 'bg-[var(--bg-inverse-primary)] text-[var(--content-inverse-primary)]'
            : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)] hover:text-[var(--content-primary)]'
        }
      `}
    >
      {label}
      {count !== undefined && (
        <span className="font-mono text-xs text-[var(--content-quaternary)]">
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
            className="ml-0.5 p-0.5 -m-0.5 rounded hover:bg-black/10 focus:outline-none focus:ring-1 focus:ring-inset"
            aria-label="Remove filter"
          >
            ✕
          </span>
        ) : (
          <span className="text-xs leading-none">✕</span>
        )
      )}
    </button>
  );
}
