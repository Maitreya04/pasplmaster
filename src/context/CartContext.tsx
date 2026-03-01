import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import type { CartItem as CartItemType, Customer, Item, Transport } from '../types';

interface CartContextValue {
  items: CartItemType[];
  addItem: (item: Item, qty: number, specialRate?: number | null) => void;
  updateQty: (itemId: number, qty: number) => void;
  setSpecialRate: (itemId: number, rate: number | null) => void;
  removeItem: (itemId: number) => void;
  clearCart: () => void;
  totalCount: number;
  totalValue: number;
  getCartItem: (itemId: number) => CartItemType | undefined;
  // Form state (persists across CartPage ↔ NewOrderPage navigation)
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

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItemType[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedTransport, setSelectedTransport] = useState<Transport | null>(null);
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal');
  const [notes, setNotes] = useState('');

  const addItem = useCallback(
    (item: Item, qty: number, specialRate: number | null = null) => {
      setItems((prev) => {
        const existing = prev.find((c) => c.item.id === item.id);
        if (existing) {
          return prev.map((c) =>
            c.item.id === item.id
              ? {
                  ...c,
                  qty: c.qty + qty,
                  specialRate: specialRate ?? c.specialRate,
                }
              : c,
          );
        }
        return [...prev, { item, qty, specialRate }];
      });
    },
    [],
  );

  const updateQty = useCallback((itemId: number, qty: number) => {
    setItems((prev) => {
      if (qty < 1) return prev.filter((c) => c.item.id !== itemId);
      return prev.map((c) =>
        c.item.id === itemId ? { ...c, qty } : c,
      );
    });
  }, []);

  const setSpecialRate = useCallback((itemId: number, rate: number | null) => {
    setItems((prev) =>
      prev.map((c) =>
        c.item.id === itemId ? { ...c, specialRate: rate } : c,
      ),
    );
  }, []);

  const removeItem = useCallback((itemId: number) => {
    setItems((prev) => prev.filter((c) => c.item.id !== itemId));
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setSelectedCustomer(null);
    setSelectedTransport(null);
    setPriority('normal');
    setNotes('');
  }, []);

  const getCartItem = useCallback(
    (itemId: number) => items.find((c) => c.item.id === itemId),
    [items],
  );

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
      getCartItem,
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
      getCartItem,
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

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
