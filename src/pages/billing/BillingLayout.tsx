import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  SquaresFour,
  ClipboardText,
  ClockCounterClockwise,
  HourglassHigh,
  Lightning,
  PlusCircle,
  Prohibit,
  Desk,
  CloudWarning,
  ChartLineUp,
} from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import type { BottomNavItem } from '../../components/shared/BottomNav';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';
import { useAuth } from '../../context/AuthContext';
import { useRolePushNotifications } from '../../hooks/useRolePushNotifications';
import { NotificationBell } from '../../components/notifications/NotificationBell';
import { PushAlertsCompact } from '../../components/notifications/PushAlertsCompact';
import { useSalesAttributionAccess } from '../../hooks/useSalesAttributionAccess';

const preloadDashboard = () => import('./DashboardPage');
const preloadNeedsReview = () => import('./NeedsReviewPage');
const preloadPending = () => import('./PendingPage');
const preloadHistory = () => import('./HistoryPage');
const preloadRejected = () => import('./RejectedPage');
const preloadLiveQueue = () => import('./LiveQueuePage');
const preloadBillingDesk = () => import('./BillingDeskPage');
const preloadNewOrder = () => import('./BillingNewOrderLayout');
const preloadOfflinePicks = () => import('./OfflinePickConflictsPage');
const preloadMySales = () => import('./MySalesPage');

const NAV_ITEMS: BottomNavItem[] = [
  { icon: SquaresFour, label: 'Dashboard', path: '/billing', preload: preloadDashboard },
  {
    icon: Lightning,
    label: 'Live Queue',
    path: '/billing/queue',
    preload: preloadLiveQueue,
  },
  {
    icon: Desk,
    label: 'Desk',
    path: '/billing/desk',
    match: (pathname: string) => pathname.startsWith('/billing/desk'),
    preload: preloadBillingDesk,
    desktopOnly: true,
  },
  {
    icon: PlusCircle,
    label: 'New Order',
    path: '/billing/new-order',
    match: (pathname: string) => pathname.startsWith('/billing/new-order'),
    preload: preloadNewOrder,
  },
  {
    icon: ClipboardText,
    label: 'Needs Review',
    path: '/billing/needs-review',
    match: (pathname: string) => (
      pathname === '/billing/needs-review' || pathname.startsWith('/billing/review/')
    ),
    preload: preloadNeedsReview,
  },
  { icon: HourglassHigh, label: 'Pending', path: '/billing/pending', preload: preloadPending },
  { icon: Prohibit, label: 'Rejected', path: '/billing/rejected', preload: preloadRejected },
  {
    icon: CloudWarning,
    label: 'Offline',
    path: '/billing/offline-picks',
    preload: preloadOfflinePicks,
  },
  { icon: ClockCounterClockwise, label: 'History', path: '/billing/history', preload: preloadHistory },
];

export default function BillingLayout(): React.JSX.Element | null {
  const location = useLocation();
  const navigate = useNavigate();
  const { userId, userName, role } = useAuth();
  const { data: hasSalesAttribution = false } = useSalesAttributionAccess(role === 'billing');
  const push = useRolePushNotifications({ role, userId, userName });
  const navItems = hasSalesAttribution
    ? [
        ...NAV_ITEMS,
        {
          icon: ChartLineUp,
          label: 'My Sales',
          path: '/billing/my-sales',
          preload: preloadMySales,
        },
      ]
    : NAV_ITEMS;

  return (
    <div className="role-billing min-h-screen lg:h-[100dvh] lg:overflow-hidden bg-[var(--bg-primary)] relative">
      <div className="flex min-h-screen lg:h-full lg:min-h-0">
        {/* Sidebar — visible on lg+ */}
        <aside className="hidden lg:flex flex-col w-56 h-full min-h-0 border-r border-[var(--border-opaque)] bg-[var(--bg-secondary)] py-6 px-3 shrink-0 overflow-y-auto">
          <div className="flex items-center justify-between gap-2 px-3 mb-4">
            <p className="text-xs font-semibold text-[var(--content-quaternary)] uppercase tracking-wider">
              Billing
            </p>
            <div className="flex items-center gap-1 shrink-0">
              <NotificationBell userId={userId} role={role} />
              <PushAlertsCompact label="Billing alerts" push={push} />
            </div>
          </div>
          {navItems.map(({ icon: IconCmp, label, path, match }) => {
            const active = match
              ? match(location.pathname, location.search)
              : location.pathname === path;
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`flex items-center gap-3 px-3 py-3 min-h-11 rounded-xl text-sm font-medium transition-colors duration-150 mb-1 w-full text-left ${
                  active
                    ? 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                    : 'text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <IconCmp size={20} weight={active ? 'fill' : 'regular'} />
                {label}
              </button>
            );
          })}
        </aside>

        {/* Content */}
        <main className="flex-1 flex flex-col min-w-0 pb-[6.5rem] lg:pb-0 lg:h-full lg:min-h-0 lg:overflow-hidden">
          {!location.pathname.startsWith('/billing/new-order') && (
            <div className="lg:hidden sticky top-0 z-30 flex items-center justify-end gap-2 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 backdrop-blur-sm">
              <NotificationBell userId={userId} role={role} />
              <PushAlertsCompact label="Billing alerts" push={push} />
            </div>
          )}
          {/* Mobile: document scroll (same as SalesLayout). Desktop: bounded flex scrollport. */}
          <div className="flex-1 flex flex-col lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      <div className="lg:hidden">
        <BottomNav items={navItems.filter((item) => !item.desktopOnly)} />
      </div>
      <DevRoleSwitcher />
    </div>
  );
}
