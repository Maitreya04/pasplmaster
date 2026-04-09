import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CaretRight, Warning } from '@phosphor-icons/react';
import { useUserNotifications } from '../../hooks/useUserNotifications';
import type { UserNotification } from '../../types';

function deepLinkFromPayload(n: UserNotification): string | null {
  const p = n.payload;
  if (typeof p.deep_link === 'string' && p.deep_link.startsWith('/')) {
    return p.deep_link;
  }
  if (n.type === 'order_ready_to_pick' && n.order_id) {
    return `/picking?claimOrderId=${n.order_id}`;
  }
  if (n.type === 'item_flagged_by_picker' && n.order_id) {
    // If edge function didn't provide a deep link, prefer Sales list on sales-facing notifications.
    return '/sales/orders';
  }
  if (n.type === 'order_update_for_sales') {
    return '/sales/orders';
  }
  return null;
}

function timeShort(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

interface NotificationBellProps {
  userId: number | null;
}

export function NotificationBell({ userId }: NotificationBellProps): React.JSX.Element {
  const navigate = useNavigate();
  const { items, loading, fetchError, unreadCount, markRead, markAllRead } =
    useUserNotifications(userId);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onRowClick = useCallback(
    async (n: UserNotification) => {
      const link = deepLinkFromPayload(n);
      if (n.read_at === null) {
        await markRead(n.id);
      }
      setOpen(false);
      if (link) navigate(link);
    },
    [markRead, navigate],
  );

  if (!userId) return <></>;

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative min-h-10 min-w-10 flex items-center justify-center rounded-full text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        aria-label={fetchError ? `Notifications — error: ${fetchError}` : 'Notifications'}
        aria-expanded={open}
        title={fetchError ?? undefined}
      >
        <Bell size={22} weight={unreadCount > 0 ? 'fill' : 'regular'} />
        {fetchError && (
          <span className="absolute -bottom-0.5 -right-0.5 text-[var(--content-warning)]" aria-hidden>
            <Warning size={14} weight="fill" />
          </span>
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-[var(--bg-negative)] text-[10px] font-bold text-white flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[min(100vw-2rem,22rem)] max-h-[min(70vh,28rem)] rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-xl z-50 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)]">
            <span className="text-sm font-semibold text-[var(--content-primary)]">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-xs font-medium text-[var(--content-accent)] hover:underline min-h-8 px-2"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1">
            {fetchError && (
              <p className="px-3 py-2 text-xs text-[var(--content-warning)] bg-[var(--bg-warning-subtle)] border-b border-[var(--border-warning)]">
                {fetchError}. Run Admin → Notification diagnostics or apply migration 014.
              </p>
            )}
            {loading && (
              <p className="px-4 py-6 text-sm text-[var(--content-tertiary)] text-center">Loading…</p>
            )}
            {!loading && items.length === 0 && (
              <p className="px-4 py-6 text-sm text-[var(--content-tertiary)] text-center">
                No notifications yet
              </p>
            )}
            {!loading &&
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => void onRowClick(n)}
                  className={`w-full text-left px-3 py-3 border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-tertiary)] transition-colors ${
                    n.read_at === null ? 'bg-[var(--bg-accent-subtle)]/30' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--content-primary)] truncate">
                        {n.title}
                      </p>
                      <p className="text-xs text-[var(--content-secondary)] line-clamp-3 mt-0.5 whitespace-pre-wrap">
                        {n.body}
                      </p>
                    </div>
                    <span className="text-[10px] text-[var(--content-quaternary)] shrink-0 tabular-nums">
                      {timeShort(n.created_at)}
                    </span>
                  </div>
                  {n.read_at === null && (
                    <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium text-[var(--content-accent)]">
                      <CaretRight size={12} weight="bold" />
                      Open
                    </span>
                  )}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
