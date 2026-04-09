import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { House, PlusCircle, ListBullets } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import type { BottomNavItem } from '../../components/shared/BottomNav';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';
import { CartProvider } from '../../context/CartContext';
import { prefetchItems } from '../../hooks/useItems';
import { useAuth } from '../../context/AuthContext';
import { useRolePushNotifications } from '../../hooks/useRolePushNotifications';
import { NotificationBell } from '../../components/notifications/NotificationBell';
import { PushAlertsCompact } from '../../components/notifications/PushAlertsCompact';
import { SalesChromeProvider, useSalesChrome } from './SalesChromeContext';

const preloadSalesHome = () => import('./SalesHome');
const preloadNewOrder = () => import('./NewOrderPage');
const preloadCart = () => import('./CartPage');
const preloadMyOrders = () => import('./MyOrdersPage');

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
];

export default function SalesLayout(): React.JSX.Element | null {
  useEffect(() => {
    prefetchItems();
  }, []);

  const { userId, userName, role } = useAuth();
  const push = useRolePushNotifications({ role, userId, userName });

  return (
    <SalesChromeProvider>
      <CartProvider>
        <div className="role-sales min-h-screen bg-[var(--bg-primary)] relative">
          <SalesTopBar userId={userId} role={role} push={push} />
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
  if (topBarHidden || suppressTopBarActions) return null;

  return (
    <div className="sticky top-0 z-30 flex items-center justify-end gap-2 px-4 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 backdrop-blur-sm">
      <NotificationBell userId={userId} role={role} />
      <PushAlertsCompact label="Sales alerts" push={push} />
    </div>
  );
}
