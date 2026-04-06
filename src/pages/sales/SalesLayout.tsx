import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { House, PlusCircle, ListBullets } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import type { BottomNavItem } from '../../components/shared/BottomNav';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';
import { CartProvider } from '../../context/CartContext';
import { prefetchItems } from '../../hooks/useItems';

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
  useEffect(() => { prefetchItems(); }, []);

  return (
    <CartProvider>
      <div className="role-sales min-h-screen bg-[var(--bg-primary)] relative">
        <div className="pb-[6.5rem]">
          <Outlet />
        </div>
        <BottomNav items={NAV_ITEMS} />
        <DevRoleSwitcher />
      </div>
    </CartProvider>
  );
}
