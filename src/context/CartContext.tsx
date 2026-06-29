import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import type { CartItem as CartItemType, Customer, Item, SalesLineUnit, Transport } from '../types';
import { normalizeSalesLineUnit } from '../lib/salesUnit';
import { matchCustomerFromList } from '../lib/resolveCustomerMatch';
import { useCustomers } from '../hooks/useCustomers';
import { useOrderAuthor } from './OrderAuthorContext';
import {
  readCartDraft,
  writeCartDraft,
  clearCartDraft,
  type CartDraftPayload,
} from '../lib/cartDraftStorage';

interface CartContextValue {
  items: CartItemType[];
  addItem: (
    item: Item,
    qty: number,
    specialRate?: number | null,
    focQty?: number,
    salesUnit?: SalesLineUnit,
  ) => void;
  updateQty: (lineId: string, qty: number) => void;
  updateFocQty: (lineId: string, focQty: number) => void;
  updateSalesUnit: (lineId: string, salesUnit: SalesLineUnit) => void;
  setSpecialRate: (lineId: string, rate: number | null) => void;
  removeItem: (lineId: string) => void;
  clearCart: () => void;
  totalCount: number;
  totalValue: number;
  selectedCustomer: Customer | null;
  setSelectedCustomer: (c: Customer | null) => void;
  selectedTransport: Transport | null;
  setSelectedTransport: (t: Transport | null) => void;
  priority: 'normal' | 'urgent';
  setPriority: (p: 'normal' | 'urgent') => void;
  notes: string;
  setNotes: (s: string) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const DRAFT_SAVE_DEBOUNCE_MS = 500;

function readInitialCartState(userName: string | null, userId: number | null) {
  const draft = readCartDraft(userName, userId);
  return {
    items: draft?.items ?? [],
    nextLineId: draft?.nextLineId ?? 1,
    selectedCustomer: draft?.selectedCustomer ?? null,
    selectedTransport: draft?.selectedTransport ?? null,
    priority: draft?.priority ?? ('normal' as const),
    notes: draft?.notes ?? '',
  };
}

export function CartProvider({ children }: { children: ReactNode }): React.JSX.Element | null {
  const { userName, userId } = useOrderAuthor();
  const initialState = useMemo(() => readInitialCartState(userName, userId), [userName, userId]);
  const [items, setItems] = useState<CartItemType[]>(() => initialState.items);
  const nextLineIdRef = useRef(initialState.nextLineId);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    () => initialState.selectedCustomer,
  );
  const [selectedTransport, setSelectedTransport] = useState<Transport | null>(
    () => initialState.selectedTransport,
  );
  const [priority, setPriority] = useState<'normal' | 'urgent'>(() => initialState.priority);
  const [notes, setNotes] = useState(() => initialState.notes);
  const { data: customers = [] } = useCustomers();

  useEffect(() => {
    if (!selectedCustomer || customers.length === 0) return;
    const fresh = matchCustomerFromList(
      customers,
      selectedCustomer.id,
      selectedCustomer.name,
    );
    if (fresh && fresh.id !== selectedCustomer.id) {
      setSelectedCustomer(fresh);
    }
  }, [customers, selectedCustomer]);

  const addItem = useCallback(
    (
      item: Item,
      qty: number,
      specialRate: number | null = null,
      focQty: number = 0,
      salesUnit: SalesLineUnit = 'pcs',
    ) => {
      const lineId = `line-${nextLineIdRef.current++}`;
      const paid = Math.max(0, Math.floor(qty));
      const foc = Math.max(0, Math.floor(focQty));
      if (paid < 1) return;
      setItems((prev) => [
        ...prev,
        {
          lineId,
          item,
          salesUnit: normalizeSalesLineUnit(salesUnit),
          qty: paid,
          focQty: foc,
          specialRate,
        },
      ]);
    },
    [],
  );

  const updateQty = useCallback((lineId: string, qty: number) => {
    setItems((prev) => {
      const next = prev.map((c) => {
        if (c.lineId !== lineId) return c;
        const paid = Math.max(0, Math.floor(qty));
        return { ...c, qty: paid };
      });
      return next.filter((c) => c.qty >= 1);
    });
  }, []);

  const updateFocQty = useCallback((lineId: string, focQty: number) => {
    const foc = Math.max(0, Math.floor(focQty));
    setItems((prev) =>
      prev.map((c) => (c.lineId === lineId ? { ...c, focQty: foc } : c)),
    );
  }, []);

  const updateSalesUnit = useCallback((lineId: string, salesUnit: SalesLineUnit) => {
    setItems((prev) =>
      prev.map((c) =>
        c.lineId === lineId ? { ...c, salesUnit: normalizeSalesLineUnit(salesUnit) } : c,
      ),
    );
  }, []);

  const setSpecialRate = useCallback((lineId: string, rate: number | null) => {
    setItems((prev) =>
      prev.map((c) => (c.lineId === lineId ? { ...c, specialRate: rate } : c)),
    );
  }, []);

  const removeItem = useCallback((lineId: string) => {
    setItems((prev) => prev.filter((c) => c.lineId !== lineId));
  }, []);

  const clearCart = useCallback(() => {
    clearCartDraft(userName, userId);
    setItems([]);
    nextLineIdRef.current = 1;
    setSelectedCustomer(null);
    setSelectedTransport(null);
    setPriority('normal');
    setNotes('');
  }, [userName, userId]);

  useEffect(() => {
    const payload: CartDraftPayload = {
      items,
      nextLineId: nextLineIdRef.current,
      selectedCustomer,
      selectedTransport,
      priority,
      notes,
    };

    const t = window.setTimeout(() => {
      writeCartDraft(userName, userId, payload);
    }, DRAFT_SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(t);
  }, [
    userName,
    userId,
    items,
    selectedCustomer,
    selectedTransport,
    priority,
    notes,
  ]);

  const { totalCount, totalValue } = useMemo(() => {
    let count = 0;
    let value = 0;
    for (const c of items) {
      count += c.qty + (c.focQty ?? 0);
      const price = c.specialRate ?? c.item.sales_price;
      value += price * c.qty;
    }
    return { totalCount: count, totalValue: value };
  }, [items]);

  const value: CartContextValue = useMemo(
    () => ({
      items,
      addItem,
      updateQty,
      updateFocQty,
      updateSalesUnit,
      setSpecialRate,
      removeItem,
      clearCart,
      totalCount,
      totalValue,
      selectedCustomer,
      setSelectedCustomer,
      selectedTransport,
      setSelectedTransport,
      priority,
      setPriority,
      notes,
      setNotes,
    }),
    [
      items,
      addItem,
      updateQty,
      updateFocQty,
      updateSalesUnit,
      setSpecialRate,
      removeItem,
      clearCart,
      totalCount,
      totalValue,
      selectedCustomer,
      selectedTransport,
      priority,
      notes,
    ],
  );

  return (
    <CartContext.Provider value={value}>{children}</CartContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
