export type SyncStatus = 'saved' | 'saving' | 'pending' | 'offline' | 'error';

export interface SyncStatusPillProps {
  status: SyncStatus;
  pendingCount?: number;
}

const LABELS: Record<SyncStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  pending: 'Pending',
  offline: 'Offline — saving locally',
  error: 'Save failed',
};

export function SyncStatusPill({ status, pendingCount = 0 }: SyncStatusPillProps): React.JSX.Element {
  const label =
    status === 'pending' && pendingCount > 0
      ? `${pendingCount} pending`
      : LABELS[status];

  const toneClass =
    status === 'saved'
      ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
      : status === 'error'
        ? 'border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]'
        : 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]';

  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full border px-2.5 font-ds-micro font-semibold ${toneClass}`}
    >
      {label}
    </span>
  );
}
