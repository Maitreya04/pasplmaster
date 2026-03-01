interface FilterChipProps {
  label: string;
  selected?: boolean;
  onClick: () => void;
  count?: number;
}

export function FilterChip({
  label,
  selected = false,
  onClick,
  count,
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
    </button>
  );
}
