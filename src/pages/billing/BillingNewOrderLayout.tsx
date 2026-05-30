import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { CaretLeft, PencilSimpleLine, UserCircle } from '@phosphor-icons/react';
import { CartProvider } from '../../context/CartContext';
import { OrderAuthorProvider } from '../../context/OrderAuthorContext';
import { OrderRoutesProvider, type OrderRoutes } from '../../context/OrderRoutesContext';
import { SalespersonSelectorSheet } from '../../components/shared';
import { SalesChromeProvider } from '../sales/SalesChromeContext';
import { prefetchItems } from '../../hooks/useItems';
import type { AppUser } from '../../types';

const BILLING_ORDER_ROUTES: OrderRoutes = {
  items: '/billing/new-order/items',
  cart: '/billing/new-order/cart',
  home: '/billing',
};

interface ActingAs {
  id: number;
  name: string;
}

export default function BillingNewOrderLayout(): React.JSX.Element {
  const navigate = useNavigate();
  const [actingAs, setActingAs] = useState<ActingAs | null>(null);

  useEffect(() => {
    prefetchItems();
  }, []);

  const handlePick = (user: AppUser) => {
    setActingAs({ id: user.id, name: user.full_name });
  };

  const handleCancelPick = () => {
    navigate('/billing');
  };

  const handleChange = () => {
    setActingAs(null);
    navigate('/billing/new-order', { replace: true });
  };

  if (!actingAs) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={handleCancelPick}
            className="inline-flex items-center gap-1 min-h-11 px-3 -ml-3 rounded-full text-sm font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]"
          >
            <CaretLeft size={18} weight="bold" />
            Back
          </button>
          <h1 className="text-base font-semibold text-[var(--content-primary)]">New Order</h1>
        </div>
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-[var(--bg-accent-subtle)] flex items-center justify-center mb-4">
            <UserCircle size={32} weight="regular" className="text-[var(--content-accent)]" />
          </div>
          <h2 className="text-lg font-semibold text-[var(--content-primary)]">
            Who is this order for?
          </h2>
          <p className="mt-1 max-w-sm text-sm text-[var(--content-tertiary)]">
            Pick the salesperson this order should be attributed to. They will see it in their My
            Orders and receive updates.
          </p>
        </div>
        <SalespersonSelectorSheet
          isOpen={true}
          onClose={handleCancelPick}
          onSelect={handlePick}
        />
      </div>
    );
  }

  return (
    <SalesChromeProvider>
      <OrderAuthorProvider salesperson={actingAs}>
        <OrderRoutesProvider routes={BILLING_ORDER_ROUTES}>
          <CartProvider key={`billing:${actingAs.id}`}>
            <div className="flex flex-col bg-[var(--bg-primary)] lg:h-full lg:min-h-0">
              <ActingAsBanner name={actingAs.name} onChange={handleChange} />
              <Outlet />
            </div>
          </CartProvider>
        </OrderRoutesProvider>
      </OrderAuthorProvider>
    </SalesChromeProvider>
  );
}

function ActingAsBanner({
  name,
  onChange,
}: {
  name: string;
  onChange: () => void;
}): React.JSX.Element {
  return (
    <div className="sticky top-0 z-30 flex h-11 shrink-0 items-center justify-between gap-3 px-4 border-b border-[var(--border-subtle)] bg-[var(--bg-accent-subtle)]/90 backdrop-blur-sm">
      <div className="flex items-center gap-2 min-w-0">
        <UserCircle size={18} weight="regular" className="text-[var(--content-accent)] shrink-0" />
        <p className="text-sm text-[var(--content-secondary)] truncate">
          On behalf of{' '}
          <span className="font-semibold text-[var(--content-primary)]">{name}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={onChange}
        className="inline-flex items-center gap-1 min-h-9 px-3 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)] shrink-0"
      >
        <PencilSimpleLine size={14} weight="bold" />
        Change
      </button>
    </div>
  );
}
