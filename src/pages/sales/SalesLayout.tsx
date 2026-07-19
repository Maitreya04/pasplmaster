import { useEffect } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { CloudArrowUp, House, PlusCircle, ListBullets, HourglassHigh, MapPin } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import type { BottomNavItem } from '../../components/shared/BottomNav';
import { OfflineStatusBanner } from '../../components/shared/OfflineStatusBanner';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';
import { CartProvider } from '../../context/CartContext';
import { prefetchItems } from '../../hooks/useItems';
import { prefetchCustomers } from '../../hooks/useCustomers';
import { prefetchTransports } from '../../hooks/useTransports';
import {
  useOfflineSalesOrderStats,
  useOfflineSalesOrderSync,
} from '../../hooks/useOfflineSalesOrders';
import { useAuth } from '../../context/AuthContext';
import { useRolePushNotifications } from '../../hooks/useRolePushNotifications';
import { NotificationBell } from '../../components/notifications/NotificationBell';
import { PushAlertsCompact } from '../../components/notifications/PushAlertsCompact';
import { SalesChromeProvider, useSalesChrome } from './SalesChromeContext';

const preloadSalesHome = () => import('./SalesHome');
const preloadNewOrder = () => import('./NewOrderPage');
const preloadCart = () => import('./CartPage');
const preloadMyOrders = () => import('./MyOrdersPage');
const preloadMyBeat = () => import('./MyBeatPage');
const preloadPendingRecovery = () => import('./PendingRecoveryPage');

const NAV_ITEMS: BottomNavItem[] = [
  { icon: House, label: 'Home', path: '/sales', preload: preloadSalesHome },
  {
    icon: PlusCircle,
    label: 'New Order',
    path: '/sales/new',
    match: (pathname: string) => pathname === '/sales/new' || pathname === '/sales/cart',
    preload: () => Promise.all([preloadNewOrder(), preloadCart()]),
  },
  {
    icon: ListBullets,
    label: 'My Orders',
    path: '/sales/orders',
    activeWeight: 'bold',
    preload: preloadMyOrders,
  },
  {
    icon: MapPin,
    label: 'My Beat',
    path: '/sales/beat',
    preload: preloadMyBeat,
  },
  {
    icon: HourglassHigh,
    label: 'Pending',
    path: '/sales/pending-recovery',
    preload: preloadPendingRecovery,
  },
];

export default function SalesLayout(): React.JSX.Element | null {
  useEffect(() => {
    const warmSalesCaches = () => {
      prefetchItems();
    };

    warmSalesCaches();
    void prefetchCustomers();
    void prefetchTransports();

    window.addEventListener('online', warmSalesCaches);
    window.addEventListener('focus', warmSalesCaches);
    const timer = window.setInterval(warmSalesCaches, 30_000);

    return () => {
      window.removeEventListener('online', warmSalesCaches);
      window.removeEventListener('focus', warmSalesCaches);
      window.clearInterval(timer);
    };
  }, []);

  const { userId, userName, role } = useAuth();
  const push = useRolePushNotifications({ role, userId, userName });
  const offlineStats = useOfflineSalesOrderStats();
  useOfflineSalesOrderSync();
  return (
    <SalesChromeProvider>
      <CartProvider key={`${userId ?? 'anon'}:${userName ?? 'guest'}`}>
        <div className="role-sales min-h-screen bg-[var(--bg-primary)] relative">
          <SalesTopBar userId={userId} role={role} push={push} />
          <OfflineStatusBanner
            pendingCount={offlineStats.waitingToSync}
            syncing={offlineStats.syncing > 0}
            failedCount={offlineStats.failed}
          />
          <div className="pb-[6.5rem]">
            <Outlet />
          </div>
          <BottomNav items={NAV_ITEMS} />
          <DevRoleSwitcher />
        </div>
      </CartProvider>
    </SalesChromeProvider>
  );
}

function SalesTopBar({
  userId,
  role,
  push,
}: {
  userId: number | null;
  role: Parameters<typeof NotificationBell>[0]['role'];
  push: Parameters<typeof PushAlertsCompact>[0]['push'];
}): React.JSX.Element | null {
  const { topBarHidden, suppressTopBarActions } = useSalesChrome();
  const offlineStats = useOfflineSalesOrderStats();
  if (topBarHidden || suppressTopBarActions) return null;

  return (
    <div className="sticky top-0 z-30 flex items-center justify-end gap-2 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 backdrop-blur-sm">
      {offlineStats.active > 0 && (
        <Link
          to="/sales/orders"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-2.5 text-xs font-semibold text-[var(--content-warning-on-light)]"
        >
          <CloudArrowUp size={16} weight="duotone" />
          {offlineStats.syncing > 0 ? 'Syncing' : `${offlineStats.queued} queued`}
        </Link>
      )}
      {offlineStats.active === 0 && offlineStats.failed > 0 && (
        <Link
          to="/sales/orders"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] px-2.5 text-xs font-semibold text-[var(--content-negative)]"
        >
          <CloudArrowUp size={16} weight="duotone" />
          {offlineStats.failed} sync failed
        </Link>
      )}
      <NotificationBell userId={userId} role={role} />
      <PushAlertsCompact label="Sales alerts" push={push} />
    </div>
  );
}
