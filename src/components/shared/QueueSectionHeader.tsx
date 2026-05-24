interface QueueSectionHeaderProps {
  label: string;
  count: number;
  description?: string;
  className?: string;
}

export function QueueSectionHeader({
  label,
  count,
  description,
  className = '',
}: QueueSectionHeaderProps): React.JSX.Element | null {
  if (count === 0) return null;

  return (
    <div className={`pb-2 ${className}`}>
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
          {label}
        </span>
        <span className="text-xs font-mono font-semibold text-[var(--content-quaternary)] bg-[var(--bg-tertiary)] rounded-full px-2 py-0.5">
          {count}
        </span>
      </div>
      {description && (
        <p className="mt-1 text-xs text-[var(--content-quaternary)] leading-snug">
          {description}
        </p>
      )}
    </div>
  );
}
