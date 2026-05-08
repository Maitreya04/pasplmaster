import { createContext, useContext, type ReactNode } from 'react';

/**
 * Route paths used by the new-order flow (NewOrderPage / CartPage). Defaults
 * point at the sales section; the billing on-behalf flow overrides these so
 * the same components mount under `/billing/new-order/...`.
 */
export interface OrderRoutes {
  /** Items / landing page (where "Back from cart" and "Create another" return). */
  items: string;
  /** Cart / review page (where the cart bar CTA navigates). */
  cart: string;
  /** Top-level home for the role (where success-screen "Back" goes). */
  home: string;
}

const DEFAULT_ROUTES: OrderRoutes = {
  items: '/sales/new',
  cart: '/sales/cart',
  home: '/sales',
};

const OrderRoutesContext = createContext<OrderRoutes | null>(null);

export function OrderRoutesProvider({
  routes,
  children,
}: {
  routes: OrderRoutes;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <OrderRoutesContext.Provider value={routes}>{children}</OrderRoutesContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrderRoutes(): OrderRoutes {
  return useContext(OrderRoutesContext) ?? DEFAULT_ROUTES;
}
