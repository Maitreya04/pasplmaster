import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { House, PlusCircle, ListBullets } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';
import { CartProvider } from '../../context/CartContext';
import { prefetchItems } from '../../hooks/useItems';

const NAV_ITEMS = [
  { icon: House, label: 'Home', path: '/sales' },
  { icon: PlusCircle, label: 'New Order', path: '/sales/new' },
  { icon: ListBullets, label: 'My Orders', path: '/sales/orders' },
];

export default function SalesLayout() {
  useEffect(() => { prefetchItems(); }, []);

  return (
    <CartProvider>
      <div className="role-sales min-h-screen bg-[var(--bg-primary)] relative">
        <div className="pb-20">
          <Outlet />
        </div>
        <BottomNav items={NAV_ITEMS} />
        <DevRoleSwitcher />
      </div>
    </CartProvider>
  );
}
