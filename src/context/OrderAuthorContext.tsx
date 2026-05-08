import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAuth } from './AuthContext';

/**
 * Identity used to attribute a sales order — usually the logged-in sales user,
 * but may be overridden when another role (e.g. billing) creates an order on
 * behalf of a salesperson.
 */
interface OrderAuthor {
  userId: number | null;
  userName: string | null;
}

interface OrderAuthorOverride {
  id: number;
  name: string;
}

const OrderAuthorContext = createContext<OrderAuthor | null>(null);

/**
 * Provides the salesperson identity used by NewOrderPage / CartPage / CartContext.
 * When `salesperson` is omitted, consumers fall back to the authenticated user.
 */
export function OrderAuthorProvider({
  salesperson,
  children,
}: {
  salesperson?: OrderAuthorOverride | null;
  children: ReactNode;
}): React.JSX.Element {
  const value = useMemo<OrderAuthor | null>(() => {
    if (!salesperson) return null;
    return { userId: salesperson.id, userName: salesperson.name };
  }, [salesperson]);

  return (
    <OrderAuthorContext.Provider value={value}>{children}</OrderAuthorContext.Provider>
  );
}

/**
 * Returns the effective order author identity. Falls back to `useAuth()` when
 * no override provider is mounted (i.e. the normal sales flow).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useOrderAuthor(): OrderAuthor {
  const override = useContext(OrderAuthorContext);
  const { userId, userName } = useAuth();
  if (override) return override;
  return { userId, userName };
}
