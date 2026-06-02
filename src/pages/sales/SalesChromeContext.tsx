import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface SalesChromeState {
  topBarHidden: boolean;
  setTopBarHidden: (hidden: boolean) => void;
  /** Hides notification bell + push gear (e.g. while New Order search is active). */
  suppressTopBarActions: boolean;
  setSuppressTopBarActions: (suppressed: boolean) => void;
  /** Hides bottom tab bar while soft keyboard is open on sales entry. */
  bottomNavHidden: boolean;
  setBottomNavHidden: (hidden: boolean) => void;
}

const SalesChromeContext = createContext<SalesChromeState | null>(null);

export function SalesChromeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [topBarHidden, setTopBarHidden] = useState(false);
  const [suppressTopBarActions, setSuppressTopBarActions] = useState(false);
  const [bottomNavHidden, setBottomNavHidden] = useState(false);

  const value = useMemo<SalesChromeState>(
    () => ({
      topBarHidden,
      setTopBarHidden,
      suppressTopBarActions,
      setSuppressTopBarActions,
      bottomNavHidden,
      setBottomNavHidden,
    }),
    [topBarHidden, suppressTopBarActions, bottomNavHidden],
  );

  return <SalesChromeContext.Provider value={value}>{children}</SalesChromeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSalesChrome(): SalesChromeState {
  const ctx = useContext(SalesChromeContext);
  if (!ctx) {
    throw new Error('useSalesChrome must be used within SalesChromeProvider');
  }
  return ctx;
}
