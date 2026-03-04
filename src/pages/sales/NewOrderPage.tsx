import { useState, useMemo, useDeferredValue, useRef, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Minus, ShoppingCart, CaretRight, CaretDown, CurrencyInr, Check, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useItems } from '../../hooks/useItems';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { useCustomers } from '../../hooks/useCustomers';
import { usePendingItems } from '../../hooks/usePendingItems';
import { searchItems, normalizeQuery, detectCodeLike } from '../../lib/search/itemSearch';
import type { SearchResult, MatchedField } from '../../lib/search/itemSearch';
import { supabase } from '../../lib/supabase/client';
import {
  PageHeader,
  SearchInput,
  FilterChip,
  BottomSheet,
  Skeleton,
  InlineQtyEditor,
  NumberStepper,
} from '../../components/shared';
import type { Item, Customer } from '../../types';

type NarrowSuggestionType = 'brand' | 'group';

interface NarrowSuggestion {
  type: NarrowSuggestionType;
  value: string;
  label: string;
  count: number;
}

interface BrandOption {
  name: string;
  count: number;
}

interface TopCustomer {
  customer_name: string;
  order_count: number;
  last_order_date: string | null;
}

interface CustomerTopItemRow {
  customer_name: string;
  item_name: string;
  order_count: number;
  most_common_qty: number | null;
  last_ordered: string | null;
}

interface TrendingRow {
  item_name: string;
  total_order_count: number | null;
}

function hasTokenPrefix(value: string | null | undefined, token: string): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  const t = token.toLowerCase();
  return v.split(/\s+/).some(word => word.startsWith(t));
}

function buildNarrowSuggestions(
  items: Item[],
  rawQuery: string,
  activeBrand: string | null,
  activeGroup: string | null,
): NarrowSuggestion[] {
  const q = normalizeQuery(rawQuery);
  const tokens = q.split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const last = tokens[tokens.length - 1];
  if (last.length < 2) return [];

  const brandCounts = new Map<string, number>();
  const groupCounts = new Map<string, number>();

  for (const it of items) {
    if (activeBrand && it.main_group !== activeBrand) continue;
    if (activeGroup && it.parent_group !== activeGroup) continue;

    if (hasTokenPrefix(it.main_group, last)) {
      brandCounts.set(it.main_group!, (brandCounts.get(it.main_group!) ?? 0) + 1);
    }
    if (hasTokenPrefix(it.parent_group, last)) {
      groupCounts.set(it.parent_group!, (groupCounts.get(it.parent_group!) ?? 0) + 1);
    }
  }

   // If the query looks like a brand (e.g. "usha"), also surface the top
   // parent_groups within that brand even when their names don't contain the token.
  let focusedBrand: string | null = activeBrand;
  if (!focusedBrand && brandCounts.size) {
    focusedBrand = [...brandCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  if (focusedBrand && !activeGroup) {
    for (const it of items) {
      if (it.main_group !== focusedBrand || !it.parent_group) continue;
      groupCounts.set(it.parent_group, (groupCounts.get(it.parent_group) ?? 0) + 1);
    }
  }

  const brandSuggestions: NarrowSuggestion[] = [...brandCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([value, count]) => ({
      type: 'brand' as const,
      value,
      label: value,
      count,
    }));

  const groupSuggestions: NarrowSuggestion[] = [...groupCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => ({
      type: 'group' as const,
      value,
      label: value,
      count,
    }));

  // Keep this list intentionally small to avoid clutter
  return [...brandSuggestions, ...groupSuggestions].slice(0, 4);
}

import { formatCurrency, formatShortDate } from '../../utils/formatters';

function BrandFilterSheetContent({
  brands,
  selectedBrand,
  onSelect,
}: {
  brands: BrandOption[];
  selectedBrand: string | null;
  onSelect: (brand: string | null) => void;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(
    () =>
      !search
        ? brands
        : brands.filter(b => b.name.toLowerCase().includes(search.toLowerCase())),
    [brands, search],
  );

  return (
    <div className="space-y-4">
      <input
        type="text"
        placeholder="Search brands…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full h-10 px-3 rounded-lg bg-[var(--bg-tertiary)] text-[var(--content-primary)] text-sm placeholder:text-[var(--content-quaternary)] border-none outline-none focus:ring-1 focus:ring-[var(--border-subtle)]"
      />
      <div className="max-h-[50vh] overflow-y-auto -mx-2">
        <button
          onClick={() => onSelect(null)}
          className="w-full px-2 py-2 flex items-center justify-between text-sm text-left hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--content-primary)]"
        >
          <span>All brands</span>
          <span
            className={`w-2.5 h-2.5 rounded-full border ${
              selectedBrand === null
                ? 'bg-[var(--bg-accent)] border-[var(--bg-accent)]'
                : 'border-[var(--border-subtle)]'
            }`}
          />
        </button>
        {filtered.map(brand => (
          <button
            key={brand.name}
            onClick={() => onSelect(brand.name)}
            className="w-full px-2 py-2 flex items-center justify-between text-sm text-left hover:bg-[var(--bg-tertiary)] rounded-lg text-[var(--content-primary)]"
          >
            <span>{brand.name}</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-[var(--content-quaternary)]">
                {brand.count}
              </span>
              <span
                className={`w-2.5 h-2.5 rounded-full border ${
                  selectedBrand === brand.name
                    ? 'bg-[var(--bg-accent)] border-[var(--bg-accent)]'
                    : 'border-[var(--border-subtle)]'
                }`}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Smart landing empty state (Your Customers / Quick Reorder / Trending)
// ---------------------------------------------------------------------------

const EMPTY_CUSTOMER_TOP_ITEMS: CustomerTopItemRow[] = [];
const EMPTY_TOP_CUSTOMERS: TopCustomer[] = [];
const EMPTY_TRENDING: TrendingRow[] = [];

interface SmartLandingProps {
  items: Item[];
  onCustomerSelect: (customer: Customer | null) => void;
  onQuickReorderApply: (customer: Customer | null, entries: { item: Item; qty: number }[]) => void;
  scrollToSearch: () => void;
}

function SmartLanding({ items, onCustomerSelect, onQuickReorderApply, scrollToSearch }: SmartLandingProps) {
  const { userName } = useAuth();
  const { data: customers = [] } = useCustomers();

  const { data: topCustomers = EMPTY_TOP_CUSTOMERS, isLoading: topCustomersLoading } = useQuery<TopCustomer[]>({
    queryKey: ['salesperson_top_customers', userName],
    enabled: !!userName,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('salesperson_top_customers')
        .select('customer_name, order_count, last_order_date')
        .eq('salesperson_name', userName)
        .order('order_count', { ascending: false })
        .limit(8);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: trendingRaw = EMPTY_TRENDING } = useQuery<TrendingRow[]>({
    queryKey: ['customer_top_items_trending'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('customer_top_items') as any)
        .select('item_name, total_order_count:order_count.sum()')
        .group('item_name')
        .order('total_order_count', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [activeCustomerName, setActiveCustomerName] = useState<string | null>(null);
  const [quickReorderItems, setQuickReorderItems] = useState<
    { item: Item; suggestedQty: number; checked: boolean; orderCount: number; mostCommonQty: number | null }[]
  >([]);

  const nameToItem = useMemo(() => {
    const map = new Map<string, Item>();
    for (const it of items) {
      map.set(it.name, it);
    }
    return map;
  }, [items]);

  const nameToCustomer = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers) {
      map.set(c.name, c);
    }
    return map;
  }, [customers]);

  const idToItem = useMemo(() => {
    const map = new Map<number, Item>();
    for (const it of items) {
      map.set(it.id, it);
    }
    return map;
  }, [items]);

  const {
    data: customerTopItems = EMPTY_CUSTOMER_TOP_ITEMS,
    isLoading: customerTopItemsLoading,
  } = useQuery<CustomerTopItemRow[]>({
    queryKey: ['customer_top_items_by_customer', activeCustomerName],
    enabled: !!activeCustomerName,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_top_items')
        .select('customer_name, item_name, order_count, most_common_qty, last_ordered')
        .eq('customer_name', activeCustomerName)
        .order('order_count', { ascending: false })
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Build quick reorder items when selection or source data changes
  useEffect(() => {
    if (!customerTopItems || !customerTopItems.length) {
      setQuickReorderItems([]);
      return;
    }
    const rows: {
      item: Item;
      suggestedQty: number;
      checked: boolean;
      orderCount: number;
      mostCommonQty: number | null;
    }[] = [];
    for (const row of customerTopItems) {
      const item = nameToItem.get(row.item_name);
      if (!item) continue; // skip silently if item not found
      const suggested =
        row.most_common_qty && row.most_common_qty > 0 ? Math.round(Number(row.most_common_qty)) : 1;
      rows.push({
        item,
        suggestedQty: suggested,
        // Suggestions start inactive; salesperson opts in explicitly
        checked: false,
        orderCount: row.order_count ?? 0,
        mostCommonQty: row.most_common_qty,
      });
    }
    setQuickReorderItems(rows);
  }, [customerTopItems, nameToItem]);

  const hasSmartData = !!userName && !topCustomersLoading && topCustomers.length > 0;

  const trendingItems = useMemo(() => {
    if (!trendingRaw.length) return [];
    const out: { item: Item; totalOrderCount: number }[] = [];
    for (const row of trendingRaw) {
      const item = nameToItem.get(row.item_name);
      if (!item) continue; // skip silently
      out.push({ item, totalOrderCount: row.total_order_count ?? 0 });
    }
    return out;
  }, [trendingRaw, nameToItem]);

  const activeCustomer = activeCustomerName ? nameToCustomer.get(activeCustomerName) ?? null : null;

  const { data: pendingItemsForCustomer = [] } = usePendingItems({
    status: 'pending',
    customerId: activeCustomer?.id,
    enabled: !!activeCustomer,
  });

  const pendingSuggestions = useMemo(() => {
    if (!activeCustomer) return [];
    if (!pendingItemsForCustomer.length) return [];
    const out: { pendingId: number; item: Item; qty: number; createdAt: string }[] = [];
    for (const pi of pendingItemsForCustomer) {
      if (!pi.item_id) continue;
      const item = idToItem.get(pi.item_id);
      if (!item) continue;
      out.push({
        pendingId: pi.id,
        item,
        qty: pi.qty_pending,
        createdAt: pi.created_at,
      });
    }
    return out;
  }, [activeCustomer, pendingItemsForCustomer, idToItem]);

  const toggleQuickReorderItem = (itemId: number) => {
    setQuickReorderItems(prev =>
      prev.map(row =>
        row.item.id === itemId ? { ...row, checked: !row.checked } : row,
      ),
    );
  };

  if (!hasSmartData) {
    // New salesperson with no data — just show Trending section below search
    return (
      <div className="space-y-6 pt-4">
        {trendingItems.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Trending
            </h3>
            <div className="space-y-2">
              {trendingItems.map(({ item, totalOrderCount }) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl bg-[var(--bg-secondary)]"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--content-primary)] truncate">
                      {item.name}
                    </p>
                    <p className="text-xs text-[var(--content-tertiary)]">
                      Ordered {totalOrderCount} times
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 px-3 h-9 rounded-full bg-[var(--bg-accent)] text-[var(--content-on-color)] text-sm font-semibold active:scale-95"
                    onClick={() => onQuickReorderApply(null, [{ item, qty: 1 }])}
                  >
                    Quick add
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-4">
      {/* Section 1 — Your Customers */}
      <section className="space-y-3">
        <h3 className="mt-1 text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
          Your Customers
        </h3>
        <div className="flex gap-3 overflow-x-auto pb-1 pt-1 scrollbar-none">
          {topCustomers.map((c) => {
            const isActive = c.customer_name === activeCustomerName;
            return (
              <button
                key={c.customer_name}
                type="button"
                onClick={() => {
                  setActiveCustomerName(c.customer_name);
                  const customer = nameToCustomer.get(c.customer_name) ?? null;
                  onCustomerSelect(customer);
                }}
                className={`min-w-[180px] max-w-[220px] px-3 py-3 rounded-2xl text-left flex flex-col justify-between gap-1.5 ${
                  isActive
                    ? 'bg-[var(--role-primary-subtle)] border border-[var(--role-primary)] shadow-sm'
                    : 'bg-[var(--bg-secondary)] border border-[var(--border-subtle)]'
                }`}
              >
                <p className="font-semibold text-[var(--content-primary)] line-clamp-2 leading-snug">
                  {c.customer_name}
                </p>
                <p className="text-xs text-[var(--content-secondary)]">
                  {c.order_count} order{c.order_count === 1 ? '' : 's'}
                </p>
                <p className="text-[10px] text-[var(--content-tertiary)]">
                  Last order {formatShortDate(c.last_order_date)}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Section 2 — Pending from last orders */}
      {activeCustomer && pendingSuggestions.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Pending from last orders
            </h3>
            <p className="text-[10px] text-[var(--content-tertiary)]">
              Items that were out of stock earlier
            </p>
          </div>
          <div className="space-y-2">
            {pendingSuggestions.slice(0, 5).map((row) => (
              <button
                key={row.pendingId}
                type="button"
                onClick={() =>
                  onQuickReorderApply(activeCustomer, [{ item: row.item, qty: row.qty }])
                }
                className="w-full px-3 py-3 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-between gap-3 text-left active:scale-95"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-[var(--content-primary)] truncate">
                    {row.item.name}
                  </p>
                  <p className="text-[11px] text-[var(--content-tertiary)]">
                    Pending last time:{' '}
                    <span className="font-mono font-semibold">{row.qty}</span> pcs
                  </p>
                </div>
                <span className="text-xs font-semibold text-[var(--bg-accent)]">
                  Add now
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Section 3 — Quick Reorder */}
      {activeCustomerName && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Quick Reorder: {activeCustomerName}
            </h3>
            {quickReorderItems.length > 0 && (
              <p className="text-[10px] text-[var(--content-tertiary)]">
                Based on past orders
              </p>
            )}
          </div>

          {customerTopItemsLoading && (
            <p className="text-xs text-[var(--content-tertiary)]">Loading suggestions…</p>
          )}

          {!customerTopItemsLoading && quickReorderItems.length === 0 && (
            <p className="text-xs text-[var(--content-tertiary)]">
              No history yet. Use search above to add items.
            </p>
          )}

          {quickReorderItems.length > 0 && (
            <div className="space-y-2">
              {quickReorderItems.map((row) => (
                <button
                  key={row.item.id}
                  type="button"
                  onClick={() => toggleQuickReorderItem(row.item.id)}
                  className="w-full px-3 py-3 min-h-[80px] rounded-xl bg-[var(--bg-secondary)] flex items-start gap-3 text-left cursor-pointer"
                  role="checkbox"
                  aria-checked={row.checked}
                >
                  <div className="pt-1">
                    <div
                      className={`w-4 h-4 rounded-md border flex items-center justify-center transition-colors ${
                        row.checked
                          ? 'bg-[var(--bg-accent)] border-[var(--bg-accent)] text-[var(--content-on-color)]'
                          : 'bg-[var(--bg-primary)] border-[var(--border-subtle)] text-transparent'
                      }`}
                    >
                      <Check size={12} weight="bold" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-semibold text-sm text-[var(--content-primary)] whitespace-normal break-words line-clamp-2 leading-snug">
                      {row.item.name}
                    </p>
                    <p className="text-[11px] text-[var(--content-tertiary)]">
                      Ordered {row.orderCount} time{row.orderCount === 1 ? '' : 's'}, usually{' '}
                      {row.mostCommonQty && row.mostCommonQty > 0
                        ? Number(row.mostCommonQty)
                        : row.suggestedQty}{' '}
                      pcs
                    </p>
                  </div>
                  <div
                    className={`shrink-0 ${row.checked ? '' : 'opacity-60 pointer-events-none'}`}
                    onClick={(e) => {
                      // When selected, allow interacting with the stepper without toggling the row
                      if (row.checked) {
                        e.stopPropagation();
                      }
                    }}
                  >
                    <NumberStepper
                      value={row.suggestedQty}
                      min={1}
                      presets={[]}
                      variant="compact"
                      onChange={(qty) => {
                        setQuickReorderItems((prev) =>
                          prev.map((it) =>
                            it.item.id === row.item.id ? { ...it, suggestedQty: qty } : it,
                          ),
                        );
                      }}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              disabled={quickReorderItems.filter((r) => r.checked && r.suggestedQty > 0).length === 0}
              className="h-11 rounded-xl bg-[var(--bg-accent)] text-[var(--content-on-color)] font-semibold text-sm flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
              onClick={() => {
                const entries = quickReorderItems
                  .filter((r) => r.checked && r.suggestedQty > 0)
                  .map((r) => ({ item: r.item, qty: r.suggestedQty }));
                onQuickReorderApply(activeCustomer, entries);
              }}
            >
              Add{' '}
              {quickReorderItems.filter((r) => r.checked && r.suggestedQty > 0).length}
              {' '}items to Cart
            </button>
            <button
              type="button"
              className={`h-11 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-secondary)] text-sm font-semibold flex items-center justify-center gap-1.5 active:scale-95 ${
                quickReorderItems.length < 3 ? 'border-[var(--content-accent)]' : ''
              }`}
              onClick={scrollToSearch}
            >
              Search for more
            </button>
          </div>
        </section>
      )}

      {/* Section 4 — Trending */}
      {trendingItems.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            Trending
          </h3>
          <div className="space-y-2">
            {trendingItems.map(({ item, totalOrderCount }) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl bg-[var(--bg-secondary)]"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--content-primary)] truncate">
                    {item.name}
                  </p>
                  <p className="text-xs text-[var(--content-tertiary)]">
                    Ordered {totalOrderCount} times
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 px-3 h-9 rounded-full bg-[var(--bg-accent)] text-[var(--content-on-color)] text-sm font-semibold active:scale-95"
                  onClick={() => onQuickReorderApply(null, [{ item, qty: 1 }])}
                >
                  Quick add
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// highlightText — wraps matched tokens in the accent colour
// ---------------------------------------------------------------------------
function highlightText(text: string, query: string): ReactNode {
  const normalized = normalizeQuery(query);
  const tokens = normalized.split(' ').filter(Boolean);
  if (!tokens.length) return text;

  const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part) ? (
      <span key={i} className="text-[var(--bg-accent)] font-bold">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

// ---------------------------------------------------------------------------
// ItemRow
// ---------------------------------------------------------------------------
interface ItemRowProps {
  result: SearchResult;
  query: string;
  onAdd: (item: Item) => void;
  onDecrement: (item: Item, currentQty: number) => void;
  onIncrement: (item: Item, currentQty: number) => void;
  onRatePress: (item: Item) => void;
  onQtyEditOpen: (itemId: number | null) => void;
  editingItemId: number | null;
  inCartQty: number;
  price: number;
  onUpdateQty: (itemId: number, qty: number) => void;
}

function AliasCode({
  value,
  query,
  matchedField,
}: {
  value: string;
  query: string;
  matchedField: MatchedField;
}) {
  const isMatched = matchedField === 'alias1' || matchedField === 'alias' || matchedField === 'name+alias';
  return (
    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--content-secondary)] shrink-0 max-w-[120px] truncate">
      {isMatched ? highlightText(value, query) : value}
    </span>
  );
}

function ItemRow({
  result,
  query,
  onAdd,
  onDecrement,
  onIncrement,
  onRatePress,
  onQtyEditOpen,
  editingItemId,
  inCartQty,
  price,
  onUpdateQty,
}: ItemRowProps) {
  const { item, matchedField } = result;
  const isEditingQty = editingItemId === item.id;

  return (
    <li className="flex items-center gap-3 px-3 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] min-h-[60px]">
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-[var(--content-primary)] leading-snug">
          {highlightText(item.name, query)}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          {item.parent_group && (
            <p className="text-xs text-[var(--content-tertiary)] truncate shrink">
              {item.parent_group}
            </p>
          )}
          {item.alias1 && (
            <AliasCode value={item.alias1} query={query} matchedField={matchedField} />
          )}
        </div>
        <span className="font-mono text-sm font-semibold text-[var(--content-secondary)] mt-0.5 inline-block">
          {formatCurrency(price)}
        </span>
      </div>

      {inCartQty > 0 ? (
        <div className="flex items-center gap-1 shrink-0">
          {!isEditingQty && (
            <button
              onClick={() => onDecrement(item, inCartQty)}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--bg-tertiary)] text-[var(--content-primary)] hover:opacity-90 active:scale-95"
              aria-label="Decrease"
            >
              <Minus size={16} weight="bold" />
            </button>
          )}
          <InlineQtyEditor
            value={inCartQty}
            open={isEditingQty}
            onOpenChange={(open) => onQtyEditOpen(open ? item.id : null)}
            onConfirm={(qty) => {
              onUpdateQty(item.id, qty);
              onQtyEditOpen(null);
            }}
            onCancel={() => onQtyEditOpen(null)}
            allowZero
            min={1}
            max={item.stock_qty > 0 ? Math.floor(item.stock_qty) : undefined}
          />
          {!isEditingQty && (
            <button
              onClick={() => onIncrement(item, inCartQty)}
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--bg-tertiary)] text-[var(--content-primary)] hover:opacity-90 active:scale-95"
              aria-label="Increase"
            >
              <Plus size={16} weight="bold" />
            </button>
          )}
          <button
            onClick={() => onRatePress(item)}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--bg-tertiary)] text-[var(--content-tertiary)] hover:opacity-90 active:scale-95 ml-0.5"
            aria-label="Set special rate"
          >
            <CurrencyInr size={14} weight="bold" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => onAdd(item)}
          className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl bg-[var(--bg-accent)] text-[var(--content-on-color)] hover:opacity-90 active:scale-95 transition-transform"
          aria-label="Add to cart"
        >
          <Plus size={20} weight="bold" />
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// ResultSection
// ---------------------------------------------------------------------------
function ResultSection({
  label,
  results,
  query,
  onAdd,
  onDecrement,
  onIncrement,
  onRatePress,
  onQtyEditOpen,
  editingItemId,
  getCartQty,
  getPrice,
  onUpdateQty,
}: {
  label: string;
  results: SearchResult[];
  query: string;
  onAdd: (item: Item) => void;
  onDecrement: (item: Item, qty: number) => void;
  onIncrement: (item: Item, qty: number) => void;
  onRatePress: (item: Item) => void;
  onQtyEditOpen: (itemId: number | null) => void;
  editingItemId: number | null;
  getCartQty: (id: number) => number;
  getPrice: (item: Item) => number;
  onUpdateQty: (itemId: number, qty: number) => void;
}) {
  if (!results.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--content-tertiary)] px-0.5">
        {label}
      </p>
      <ul className="space-y-2">
        {results.map(r => (
          <ItemRow
            key={r.item.id}
            result={r}
            query={query}
            inCartQty={getCartQty(r.item.id)}
            price={getPrice(r.item)}
            onAdd={onAdd}
            onDecrement={onDecrement}
            onIncrement={onIncrement}
            onRatePress={onRatePress}
            onQtyEditOpen={onQtyEditOpen}
            editingItemId={editingItemId}
            onUpdateQty={onUpdateQty}
          />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewOrderPage
// ---------------------------------------------------------------------------
export default function NewOrderPage() {
  const navigate = useNavigate();
  const { data: items = [], isLoading: itemsLoading } = useItems();
  const {
    items: cartItems,
    addItem,
    updateQty,
    setSpecialRate,
    getCartItem,
    totalCount,
    totalValue,
    setSelectedCustomer,
  } = useCart();

  const [query, setQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [isBrandSheetOpen, setIsBrandSheetOpen] = useState(false);
  const [rateItem, setRateItem] = useState<Item | null>(null);
  const [rateValue, setRateValue] = useState('');
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);

  const brandOptions: BrandOption[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.main_group) counts.set(item.main_group, (counts.get(item.main_group) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [items]);

  const effectiveQuery = query.trim();
  const isCodeMode = detectCodeLike(effectiveQuery);
  const deferredQuery = useDeferredValue(effectiveQuery);
  const isStale = deferredQuery !== effectiveQuery;

  const searchableItems = useMemo(
    () =>
      items.filter(it => {
        if (selectedBrand && it.main_group !== selectedBrand) return false;
        if (selectedGroup && it.parent_group !== selectedGroup) return false;
        return true;
      }),
    [items, selectedBrand, selectedGroup],
  );

  const searchResults = useMemo(() => {
    if (deferredQuery) return searchItems(deferredQuery, searchableItems);
    // Brand chip selected but no text: show all items in that group
    if (selectedBrand) {
      return searchableItems
        .slice(0, 20)
        .map(item => ({ item, score: 100, matchType: 'exact-name' as const, matchedField: 'name' as const }));
    }
    return [];
  }, [deferredQuery, searchableItems, selectedBrand]);

  // When browsing a brand with no query there's no meaningful "best match" split
  const bestMatches = useMemo(
    () => (deferredQuery ? searchResults.slice(0, 3).filter(r => r.score >= 80) : []),
    [searchResults, deferredQuery],
  );
  const moreResults = useMemo(
    () => searchResults.slice(bestMatches.length, 20),
    [searchResults, bestMatches.length],
  );

  const narrowSuggestions = useMemo(
    () =>
      buildNarrowSuggestions(items, effectiveQuery, selectedBrand, selectedGroup),
    [items, effectiveQuery, selectedBrand, selectedGroup],
  );

  const getCartQty = (id: number) => getCartItem(id)?.qty ?? 0;
  const getPrice = (item: Item) => getCartItem(item.id)?.specialRate ?? item.sales_price;

  const handleAdd = (item: Item) => addItem(item, 1);
  const handleDecrement = (item: Item, qty: number) => updateQty(item.id, Math.max(1, qty - 1));
  const handleIncrement = (item: Item, qty: number) => updateQty(item.id, qty + 1);

  const handleRatePress = (item: Item) => {
    setRateItem(item);
    setRateValue(String(getCartItem(item.id)?.specialRate ?? ''));
  };

  const handleRateSave = () => {
    if (!rateItem) return;
    const n = parseFloat(rateValue.replace(/,/g, ''));
    setSpecialRate(rateItem.id, isNaN(n) || n < 0 ? null : n);
    setRateItem(null);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <PageHeader
        title="New Order"
        action={
          totalCount > 0 ? (
            <button
              onClick={() => navigate('/sales/cart')}
              className="flex items-center gap-1.5 min-h-[48px] min-w-[48px] px-2 rounded-lg text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]"
            >
              <ShoppingCart size={22} weight="regular" />
              <span className="font-mono text-sm font-semibold">{totalCount}</span>
            </button>
          ) : null
        }
      />

      <div className="px-4 pb-4">
        {/* Sticky search + filters */}
        <div
          ref={searchRef}
          className="sticky top-11 z-30 -mx-4 px-4 pt-1.5 pb-2 space-y-1.5 bg-[var(--bg-primary)] border-b border-[var(--border-subtle)]"
        >
          <div className="relative">
            <SearchInput
              placeholder="Search parts, name or code…"
              value={query}
              onChange={setQuery}
              loading={itemsLoading}
              autoFocus
              leftContent={
                <div className="flex items-center h-full min-w-0">
                  <button
                    type="button"
                    onClick={() => setIsBrandSheetOpen(true)}
                    className="flex items-center gap-1 px-3 h-full text-sm font-medium text-[var(--content-secondary)] hover:text-[var(--content-primary)] transition-colors min-w-0"
                    aria-label={selectedBrand ? `Brand: ${selectedBrand}` : 'All brands'}
                  >
                    <span className="truncate">
                      {selectedBrand ?? 'All brands'}
                    </span>
                    <CaretDown size={14} weight="bold" className="shrink-0" />
                  </button>
                  {selectedBrand && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedBrand(null);
                      }}
                      className="flex items-center justify-center w-8 h-full shrink-0 text-[var(--content-tertiary)] hover:text-[var(--content-primary)] transition-colors"
                      aria-label="Reset to all brands"
                    >
                      <X size={14} weight="bold" />
                    </button>
                  )}
                </div>
              }
            />
            {isCodeMode && (
              <span className="absolute right-12 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-[var(--bg-accent)] text-[var(--content-on-color)] pointer-events-none">
                CODE
              </span>
            )}
          </div>

          {narrowSuggestions.length > 0 && !selectedGroup && (
            <div className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-3 py-3 shadow-lg space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-[var(--content-tertiary)]">
                Narrow by
              </p>
              <div className="flex gap-2 overflow-x-auto scrollbar-none py-1">
                {narrowSuggestions.map(s => (
                  <button
                    key={`${s.type}-${s.value}`}
                    onClick={() => {
                      if (s.type === 'brand') setSelectedBrand(s.value);
                      if (s.type === 'group') setSelectedGroup(s.value);
                    }}
                    className="px-3 h-8 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-[var(--content-secondary)] text-xs flex items-center gap-1.5 shrink-0 active:scale-95"
                  >
                    <span>{s.label}</span>
                    <span className="text-[10px] text-[var(--content-quaternary)]">
                      ({s.count})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedGroup && (
            <div className="flex flex-wrap gap-2">
              <FilterChip
                label={`Group: ${selectedGroup}`}
                selected
                removable
                onClick={() => setSelectedGroup(null)}
              />
            </div>
          )}
        </div>

        {/* Results area */}
        <div
          className={`space-y-4 transition-opacity duration-100 ${totalCount > 0 ? 'pb-32' : ''}`}
          style={{ opacity: isStale ? 0.6 : 1 }}
        >
          {itemsLoading ? (
            <Skeleton variant="list" count={1} lines={6} />
          ) : !effectiveQuery && !selectedBrand ? (
            <SmartLanding
              items={items}
              onCustomerSelect={customer => {
                setSelectedCustomer(customer);
              }}
              onQuickReorderApply={(customer, entries) => {
                if (customer) {
                  setSelectedCustomer(customer);
                }
                for (const entry of entries) {
                  addItem(entry.item, entry.qty);
                }
                navigate('/sales/cart');
              }}
              scrollToSearch={() => {
                if (searchRef.current) {
                  searchRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
            />
          ) : searchResults.length === 0 && !isStale && effectiveQuery ? (
            <div className="pt-6 text-center space-y-4">
              <p className="font-semibold text-[var(--content-primary)]">No results</p>
              <p className="text-sm text-[var(--content-tertiary)]">
                {selectedBrand
                  ? `No "${effectiveQuery}" in ${selectedBrand}`
                  : isCodeMode
                    ? 'Code not found — check the number and try again'
                    : 'Try a shorter name or use a part code'}
              </p>
              {selectedBrand && (
                <button
                  onClick={() => setSelectedBrand(null)}
                  className="text-sm text-[var(--bg-accent)] underline"
                >
                  Search all groups
                </button>
              )}
            </div>
          ) : (
            <>
              <ResultSection
                label="Best match"
                results={bestMatches}
                query={effectiveQuery}
                onAdd={handleAdd}
                onDecrement={handleDecrement}
                onIncrement={handleIncrement}
                onRatePress={handleRatePress}
                onQtyEditOpen={setEditingItemId}
                editingItemId={editingItemId}
                getCartQty={getCartQty}
                getPrice={getPrice}
                onUpdateQty={updateQty}
              />
              <ResultSection
                label={bestMatches.length ? 'More results' : 'Results'}
                results={moreResults}
                query={effectiveQuery}
                onAdd={handleAdd}
                onDecrement={handleDecrement}
                onIncrement={handleIncrement}
                onRatePress={handleRatePress}
                onQtyEditOpen={setEditingItemId}
                editingItemId={editingItemId}
                getCartQty={getCartQty}
                getPrice={getPrice}
                onUpdateQty={updateQty}
              />
            </>
          )}
        </div>
      </div>

      {/* Cart bar */}
      {totalCount > 0 && (
        <div
          className="fixed left-0 right-0 bottom-16 z-30 flex items-center justify-between gap-4 px-4 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)] shadow-lg"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
        >
          <div>
            <p className="font-semibold text-[var(--content-primary)]">
              {cartItems.length} line{cartItems.length !== 1 ? 's' : ''} · {totalCount} pcs
            </p>
            <p className="font-mono text-lg font-bold text-[var(--content-primary)]">
              {formatCurrency(totalValue)}
            </p>
          </div>
          <button
            onClick={() => navigate('/sales/cart')}
            className="flex items-center gap-1.5 min-h-[48px] px-4 rounded-xl bg-[var(--bg-accent)] text-[var(--content-on-color)] font-semibold hover:opacity-90 active:scale-95"
          >
            View Cart
            <CaretRight size={20} weight="bold" />
          </button>
        </div>
      )}

      {/* Special rate sheet */}
      <BottomSheet
        isOpen={!!rateItem}
        onClose={() => setRateItem(null)}
        title={rateItem ? `Special rate: ${rateItem.name}` : ''}
      >
        {rateItem && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--content-tertiary)]">
              Default: {formatCurrency(rateItem.sales_price)}
            </p>
            <input
              type="text"
              inputMode="decimal"
              placeholder="Enter special rate…"
              value={rateValue}
              onChange={e => setRateValue(e.target.value)}
              autoFocus
              className="w-full h-12 px-4 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-primary)] font-mono placeholder:text-[var(--content-quaternary)] border-none outline-none focus:ring-1 focus:ring-[var(--border-subtle)]"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setSpecialRate(rateItem.id, null); setRateItem(null); }}
                className="flex-1 h-12 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-secondary)] font-semibold hover:opacity-90"
              >
                Clear rate
              </button>
              <button
                onClick={handleRateSave}
                className="flex-1 h-12 rounded-xl bg-[var(--bg-accent)] text-[var(--content-on-color)] font-semibold hover:opacity-90 active:scale-95"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Brand filter sheet */}
      <BottomSheet
        isOpen={isBrandSheetOpen}
        onClose={() => setIsBrandSheetOpen(false)}
        title="Filter by brand"
      >
        <BrandFilterSheetContent
          brands={brandOptions}
          selectedBrand={selectedBrand}
          onSelect={brand => {
            setSelectedBrand(brand);
            setIsBrandSheetOpen(false);
          }}
        />
      </BottomSheet>
    </div>
  );
}
