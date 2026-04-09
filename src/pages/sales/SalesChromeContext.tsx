import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface SalesChromeState {
  topBarHidden: boolean;
  setTopBarHidden: (hidden: boolean) => void;
}

const SalesChromeContext = createContext<SalesChromeState | null>(null);

export function SalesChromeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [topBarHidden, setTopBarHidden] = useState(false);

  const value = useMemo<SalesChromeState>(
    () => ({
      topBarHidden,
      setTopBarHidden,
    }),
    [topBarHidden],
  );

  return <SalesChromeContext.Provider value={value}>{children}</SalesChromeContext.Provider>;
}

export function useSalesChrome(): SalesChromeState {
  const ctx = useContext(SalesChromeContext);
  if (!ctx) {
    throw new Error('useSalesChrome must be used within SalesChromeProvider');
  }
  return ctx;
}

