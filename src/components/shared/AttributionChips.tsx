/** Matches StatusBadge “approved” so billing attribution reads as one system with workflow. */
export function BillingApproverChip({ name }: { name: string }): React.JSX.Element {
  return (
    <span
      title={`Approved by ${name}`}
      aria-label={`Approved by ${name}`}
      className="
        inline-flex items-center h-6 max-w-[11rem] sm:max-w-[14rem]
        rounded-full border gap-1 pl-2.5 pr-3
        text-xs font-semibold leading-none shrink-0
        bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border-[var(--border-positive)]
      "
    >
      <span className="opacity-80 font-medium">By</span>
      <span className="font-bold truncate min-w-0">{name}</span>
    </span>
  );
}

export function PickerAttributionChip({
  name,
  active = false,
}: {
  name: string;
  active?: boolean;
}): React.JSX.Element {
  const label = active ? 'Picking' : 'Picked';
  const title = active ? `Being picked by ${name}` : `Picked by ${name}`;

  return (
    <span
      title={title}
      aria-label={title}
      className={`
        inline-flex items-center h-6 max-w-[11rem] sm:max-w-[14rem]
        rounded-full border gap-1 pl-2.5 pr-3
        text-xs font-semibold leading-none shrink-0
        ${
          active
            ? 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] border-[var(--border-warning)]'
            : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)] border-[var(--border-opaque)]'
        }
      `}
    >
      <span className="opacity-80 font-medium">{label}</span>
      <span className="font-bold truncate min-w-0">{name}</span>
    </span>
  );
}
