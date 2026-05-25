import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, Warning, X, ArrowSquareOut } from '@phosphor-icons/react';
import { appHaptics } from '../../lib/haptics';
import { useUserNotifications } from '../../hooks/useUserNotifications';
import type { UserNotification } from '../../types';

type AppRole = 'sales' | 'billing' | 'picking' | 'admin';

function roleFromPath(pathname: string): AppRole | null {
  if (pathname.startsWith('/billing')) return 'billing';
  if (pathname.startsWith('/sales')) return 'sales';
  if (pathname.startsWith('/picking')) return 'picking';
  if (pathname.startsWith('/admin')) return 'admin';
  return null;
}

function payloadDeepLink(n: UserNotification): string | null {
  const dl = n.payload?.deep_link;
  return typeof dl === 'string' ? dl : null;
}

/**
 * Billing bell: only picker → billing signals (flags needing review).
 * Excludes sales inbox copies of the same event (`deep_link` under `/sales`) and any `order_update_for_sales` rows.
 */
function matchesRole(n: UserNotification, role: AppRole | null): boolean {
  if (!role) return true;
  if (role === 'sales') {
    if (n.type === 'order_update_for_sales') return true;
    if (n.type === 'pending_item_back_in_stock') return true;
    if (n.type !== 'item_flagged_by_picker') return false;
    const dl = payloadDeepLink(n);
    if (dl?.startsWith('/billing')) return false;
    return dl == null || dl.startsWith('/sales');
  }
  if (role === 'billing') {
    if (n.type === 'order_update_for_sales') return false;
    if (n.type === 'pending_item_ready_for_billing') return true;
    if (n.type !== 'item_flagged_by_picker') return false;
    const dl = payloadDeepLink(n);
    if (dl?.startsWith('/sales')) return false;
    return dl == null || dl.startsWith('/billing');
  }
  if (role === 'picking') {
    return n.type === 'order_ready_to_pick' || n.type === 'pick_complete_reminder';
  }
  return false;
}

function deepLinkFromPayload(n: UserNotification): string | null {
  const p = n.payload;
  if (typeof p.deep_link === 'string' && p.deep_link.startsWith('/')) {
    return p.deep_link;
  }
  if (n.type === 'pick_complete_reminder' && n.order_id) {
    return `/picking?focusOrderId=${n.order_id}`;
  }
  if (n.type === 'order_ready_to_pick' && n.order_id) {
    const dl = payloadDeepLink(n);
    if (dl) {
      // Legacy inbox rows may still use ?claimOrderId=
      if (dl.includes('claimOrderId=')) {
        const match = dl.match(/claimOrderId=(\d+)/);
        if (match?.[1]) return `/picking/preview/${match[1]}?source=pool`;
      }
      return dl;
    }
    return `/picking/preview/${n.order_id}?source=assigned`;
  }
  if (n.type === 'item_flagged_by_picker' && n.order_id) {
    return `/billing/desk?orderId=${n.order_id}`;
  }
  if (n.type === 'order_update_for_sales') {
    return '/sales/orders';
  }
  if (n.type === 'pending_item_back_in_stock') {
    return '/sales/pending-recovery';
  }
  if (n.type === 'pending_item_ready_for_billing' && n.order_id) {
    return `/billing/desk?orderId=${n.order_id}`;
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

function formatFullTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayHeading(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (isSameCalendarDay(d, now)) return 'Today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (isSameCalendarDay(d, y)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  });
}

function notificationTypeLabel(type: string): string {
  switch (type) {
    case 'order_ready_to_pick':
      return 'Ready to pick';
    case 'pick_complete_reminder':
      return 'Complete pick?';
    case 'item_flagged_by_picker':
      return 'Picker flag';
    case 'order_update_for_sales':
      return 'Order update';
    case 'pending_item_back_in_stock':
      return 'Back in stock';
    case 'pending_item_ready_for_billing':
      return 'Ready for billing';
    default:
      return type.replace(/_/g, ' ');
  }
}

/** Prefer party name for sales order updates (matches edge function; fixes older rows with order # in title). */
function notificationDisplayTitle(n: UserNotification): string {
  if (n.type === 'order_update_for_sales') {
    const name = typeof n.payload?.customerName === 'string' ? n.payload.customerName.trim() : '';
    if (name) return `Order update · ${name}`;
  }
  return n.title;
}

interface NotificationBellProps {
  userId: number | null;
  role?: AppRole | null;
}

export function NotificationBell({ userId, role = null }: NotificationBellProps): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { items, loading, fetchError, markRead, markAllRead } = useUserNotifications(userId);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const scopedRole = useMemo(() => roleFromPath(location.pathname) ?? role, [location.pathname, role]);

  const filteredItems = useMemo(
    () => items.filter((n) => matchesRole(n, scopedRole)),
    [items, scopedRole],
  );
  const unreadCount = useMemo(
    () => filteredItems.filter((n) => n.read_at === null).length,
    [filteredItems],
  );

  const sortedItems = useMemo(
    () =>
      [...filteredItems].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [filteredItems],
  );

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      appHaptics.selection();
    }
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

  const handleClose = useCallback(() => {
    appHaptics.selection();
    setOpen(false);
  }, []);

  if (!userId) return <></>;

  const drawer =
    open &&
    createPortal(
      <div
        className="fixed inset-0 z-[60] flex justify-end"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-drawer-title"
      >
        <button
          type="button"
          className="absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm transition-opacity"
          onClick={handleClose}
          aria-label="Close notifications"
        />
        <aside
          ref={panelRef}
          className={`
            relative z-10 flex h-[100dvh] w-full max-w-md flex-col
            border-l border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-2xl
            animate-slide-in-right [animation-fill-mode:both]
          `}
          style={{
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          }}
        >
          <div className="flex shrink-0 flex-col gap-1 border-b border-[var(--border-subtle)] px-4 pb-3 pt-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="notification-drawer-title"
                  className="text-lg font-semibold tracking-tight text-[var(--content-primary)]"
                >
                  Notifications
                </h2>
                <p className="mt-0.5 text-sm text-[var(--content-tertiary)]">
                  {loading
                    ? 'Loading…'
                    : fetchError
                      ? 'Could not refresh'
                      : `${unreadCount} unread · ${filteredItems.length} total`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void markAllRead()}
                    className="min-h-10 rounded-xl px-3 text-sm font-medium text-[var(--content-accent)] hover:bg-[var(--bg-tertiary)]"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex min-h-10 min-w-10 items-center justify-center rounded-full text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]"
                  aria-label="Close"
                >
                  <X size={22} weight="regular" />
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {fetchError && (
              <p className="border-b border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 py-3 text-sm text-[var(--content-warning)]">
                {fetchError}. Run Admin → Notification diagnostics or apply migration 014.
              </p>
            )}
            {loading && (
              <p className="px-4 py-10 text-center text-sm text-[var(--content-tertiary)]">Loading…</p>
            )}
            {!loading && filteredItems.length === 0 && (
              <p className="px-4 py-10 text-center text-sm text-[var(--content-tertiary)]">
                {items.length === 0 ? 'No notifications yet' : 'No notifications for this role'}
              </p>
            )}
            {!loading &&
              sortedItems.map((n, i) => {
                const showDay =
                  i === 0 || dayHeading(n.created_at) !== dayHeading(sortedItems[i - 1]!.created_at);
                const hasLink = deepLinkFromPayload(n) !== null;
                const unread = n.read_at === null;

                return (
                  <Fragment key={n.id}>
                    {showDay && (
                      <div className="sticky top-0 z-[1] border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)]/95 px-4 py-2 backdrop-blur-sm">
                        <p className="font-ds-label-size font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
                          {dayHeading(n.created_at)}
                        </p>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void onRowClick(n)}
                      className={`
                        w-full border-b border-[var(--border-subtle)] text-left transition-colors
                        hover:bg-[var(--bg-tertiary)]
                        ${unread ? 'bg-[var(--bg-accent-subtle)]/25' : ''}
                      `}
                    >
                      <div
                        className={`flex gap-3 px-4 py-4 ${unread ? 'border-l-[3px] border-l-[var(--bg-accent)] pl-[13px]' : 'border-l-[3px] border-l-transparent'}`}
                      >
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md bg-[var(--bg-tertiary)] px-2 py-0.5 font-ds-micro font-semibold uppercase tracking-wide text-[var(--content-secondary)]">
                              {notificationTypeLabel(n.type)}
                            </span>
                            {n.order_id != null && (
                              <span className="font-mono text-xs text-[var(--content-tertiary)]">
                                Order #{n.order_id}
                              </span>
                            )}
                          </div>
                          <p className="text-base font-semibold leading-snug text-[var(--content-primary)]">
                            {notificationDisplayTitle(n)}
                          </p>
                          <p className="text-sm leading-relaxed text-[var(--content-secondary)] whitespace-pre-wrap">
                            {n.body}
                          </p>
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-[var(--content-tertiary)]">
                            <span className="font-medium text-[var(--content-secondary)] tabular-nums">
                              {timeShort(n.created_at)}
                            </span>
                            <span className="text-[var(--content-quaternary)]">·</span>
                            <span className="tabular-nums">{formatFullTimestamp(n.created_at)}</span>
                          </div>
                          {hasLink && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--content-accent)]">
                              <ArrowSquareOut size={14} weight="bold" aria-hidden />
                              Open related screen
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </Fragment>
                );
              })}
          </div>
        </aside>
      </div>,
      document.body,
    );

  return (
    <div className="relative">
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
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.125rem] h-[1.125rem] px-1 rounded-full bg-[var(--bg-negative)] font-ds-micro font-bold text-white flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {drawer}
    </div>
  );
}
