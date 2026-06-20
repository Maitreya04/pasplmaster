import { useEffect, useState } from 'react';
import { CloudArrowUp, WifiSlash } from '@phosphor-icons/react';

interface OfflineStatusBannerProps {
  pendingCount?: number;
  syncing?: boolean;
  /** Resolved locally but last upload attempt failed — not the same as waiting to sync. */
  failedCount?: number;
  label?: string;
}

export function OfflineStatusBanner({
  pendingCount = 0,
  syncing = false,
  failedCount = 0,
  label,
}: OfflineStatusBannerProps): React.JSX.Element | null {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (!offline && pendingCount <= 0 && !syncing && failedCount <= 0) return null;

  const message =
    label ??
    (offline
      ? syncing
        ? 'Offline — syncing when possible'
        : pendingCount > 0
          ? `Offline — ${pendingCount} waiting to sync`
          : failedCount > 0
            ? `Offline — ${failedCount} sync failed`
            : 'Offline — using saved data'
      : syncing
        ? 'Syncing saved changes'
        : pendingCount > 0
          ? `${pendingCount} waiting to sync`
          : `${failedCount} sync failed`);

  return (
    <div
      className={`flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold ${
        offline
          ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
          : 'border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
      }`}
    >
      {offline ? (
        <WifiSlash size={16} weight="bold" className="shrink-0" />
      ) : (
        <CloudArrowUp size={16} weight="fill" className="shrink-0" />
      )}
      <span className="min-w-0 flex-1">{message}</span>
    </div>
  );
}
