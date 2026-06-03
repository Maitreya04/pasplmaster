interface BusyBillableEmptyStateProps {
  skipCount: number;
  compact?: boolean;
}

export function BusyBillableEmptyState({
  skipCount,
  compact = false,
}: BusyBillableEmptyStateProps): React.JSX.Element | null {
  if (skipCount <= 0) return null;

  const itemWord = skipCount === 1 ? 'item' : 'items';

  return (
    <div
      className={`text-center border-b border-[var(--border-faint)] bg-[var(--bg-primary)] ${
        compact ? 'px-3 py-4' : 'px-4 py-6'
      }`}
    >
      <p className="font-ds-body-size font-semibold text-[var(--content-secondary)]">
        Nothing to enter in Busy today
      </p>
      <p className="mt-1 font-ds-caption-size text-[var(--content-quaternary)] max-w-sm mx-auto">
        {skipCount} {itemWord} marked out of stock — goes to pending when you close this order.
      </p>
    </div>
  );
}
