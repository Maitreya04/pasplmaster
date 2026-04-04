import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  type ReactNode,
} from 'react';
import type { CartItem as CartItemType, Customer, Item, Transport } from '../types';
import { useAuth } from './AuthContext';
import {
  readCartDraft,
  writeCartDraft,
  clearCartDraft,
  type CartDraftPayload,
} from '../lib/cartDraftStorage';

interface CartContextValue {
  items: CartItemType[];
  addItem: (item: Item, qty: number, specialRate?: number | null) => void;
  updateQty: (lineId: string, qty: number) => void;
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

export function CartProvider({ children }: { children: ReactNode }): React.JSX.Element | null {
  const { userName, userId } = useAuth();
  const [items, setItems] = useState<CartItemType[]>([]);
  const nextLineIdRef = useRef(1);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedTransport, setSelectedTransport] = useState<Transport | null>(null);
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [notes, setNotes] = useState('');
  const [draftHydrated, setDraftHydrated] = useState(false);

  const addItem = useCallback(
    (item: Item, qty: number, specialRate: number | null = null) => {
      const lineId = `line-${nextLineIdRef.current++}`;
      setItems((prev) => [...prev, { lineId, item, qty, specialRate }]);
    },
    [],
  );

  const updateQty = useCallback((lineId: string, qty: number) => {
    setItems((prev) => {
      if (qty < 1) return prev.filter((c) => c.lineId !== lineId);
      return prev.map((c) => (c.lineId === lineId ? { ...c, qty } : c));
    });
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

  useLayoutEffect(() => {
    setDraftHydrated(false);
    const draft = readCartDraft(userName, userId);
    if (draft) {
      setItems(draft.items);
      nextLineIdRef.current = draft.nextLineId;
      setSelectedCustomer(draft.selectedCustomer);
      setSelectedTransport(draft.selectedTransport);
      setPriority(draft.priority);
      setNotes(draft.notes);
    } else {
      setItems([]);
      nextLineIdRef.current = 1;
      setSelectedCustomer(null);
      setSelectedTransport(null);
      setPriority('normal');
      setNotes('');
    }
    setDraftHydrated(true);
  }, [userName, userId]);

  useEffect(() => {
    if (!draftHydrated) return;

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
    draftHydrated,
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
      count += c.qty;
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
