/** Post-copy guidance — status only; actions live in the footer bar. */
export function BusyEntryCopyHint({
  remaining,
}: {
  remaining: number;
  /** @deprecated Use action bar "Mark all entered". */
  onMarkAllEntered?: () => void;
}): React.JSX.Element | null {
  if (remaining <= 0) return null;

  return (
    <div
      className="border-b border-[var(--border-opaque)] bg-[var(--bg-primary)] px-4 py-2"
      role="status"
    >
      <p className="font-ds-caption-size text-[var(--content-secondary)] leading-snug">
        Lines copied — paste in Busy, then tick each line below.
      </p>
    </div>
  );
}
