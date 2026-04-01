import { useState, useMemo, useDeferredValue, useRef, useEffect, memo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ShoppingCart, CaretRight, CurrencyInr, Check, FunnelSimple } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useItems } from '../../hooks/useItems';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { useCustomers } from '../../hooks/useCustomers';
import { usePendingItems } from '../../hooks/usePendingItems';
import {
  searchItems,
  normalizeQuery,
  detectCodeLike,
  MAX_RESULTS,
} from '../../lib/search/itemSearch';
import type { SearchResult, MatchedField } from '../../lib/search/itemSearch';
import { buildNarrowIndex, buildNarrowSuggestions } from '../../lib/search/narrowSuggestions';
import { buildSearchIndex } from '../../lib/search/searchIndex';
import { formatCurrency, formatShortDate } from '../../utils/formatters';
import { supabase } from '../../lib/supabase/client';
import {
  PageHeader,
  SearchInput,
  BottomSheet,
  Skeleton,
  InlineQtyEditor,
  NumberStepper,
} from '../../components/shared';
import type { Item, Customer } from '../../types';

/** First paint of "More results" before expanding; search still returns up to MAX_RESULTS. */
const INITIAL_MORE_VISIBLE = 36;
const MORE_RESULTS_PAGE = 36;

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

function BrandFilterSheetContent({
  brands,
  selectedBrand,
  groups,
  selectedGroup,
  onSelect,
  onSelectGroup,
}: {
  brands: BrandOption[];
  selectedBrand: string | null;
  groups: BrandOption[];
  selectedGroup: string | null;
  onSelect: (brand: string | null) => void;
  onSelectGroup: (group: string | null) => void;
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
      {selectedBrand && (
        <div className="space-y-2 border-t border-[var(--border-subtle)] pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
              Sub-category
            </p>
            {selectedGroup && (
              <button
                type="button"
                onClick={() => onSelectGroup(null)}
                className="text-xs font-medium text-[var(--bg-accent)]"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {groups.length === 0 ? (
              <p className="text-sm text-[var(--content-tertiary)]">
                No sub-categories for this brand
              </p>
            ) : (
              groups.map((group) => (
                <button
                  key={group.name}
                  type="button"
                  onClick={() => onSelectGroup(selectedGroup === group.name ? null : group.name)}
                  className={`h-10 rounded-full px-3 text-sm font-medium transition-colors ${
                    selectedGroup === group.name
                      ? 'bg-[var(--bg-accent)] text-[var(--content-on-color)]'
                      : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
                  }`}
                >
                  {group.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
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
      const query = supabase.from('customer_top_items') as unknown as {
        select: (s: string) => {
          group: (g: string) => {
            order: (o: string, opts: { ascending: boolean }) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              limit: (l: number) => Promise<{ data: any[] | null; error: any }>
            }
          }
        }
      };
      const { data, error } = await query
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
                className={`min-w-44 max-w-56 px-3 py-3 rounded-lg text-left flex flex-col justify-between gap-1.5 ${
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
                <p className="text-xs text-[var(--content-tertiary)] mt-1">
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
            <p className="text-xs text-[var(--content-tertiary)] mt-1">
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
                  <p className="text-xs text-[var(--content-tertiary)] mt-1">
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
              <p className="text-xs text-[var(--content-tertiary)] mt-1">
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
                  className="w-full px-3 py-3 min-h-20 rounded-xl bg-[var(--bg-secondary)] flex items-start gap-3 text-left cursor-pointer"
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
                    <p className="text-xs text-[var(--content-tertiary)] mt-1">
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
  const rawTokens = query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);
  const normTokens = normalized.split(' ').filter(Boolean);
  // Union raw + expanded tokens so "RR" and "rear" both highlight (sales shorthand).
  const tokens = [...new Set([...rawTokens, ...normTokens])].filter(t => t.length >= 1);
  if (!tokens.length) return text;

  const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, i) =>
    tokens.some(t => t.length > 0 && part.toLowerCase() === t.toLowerCase()) ? (
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
  onStartAdd: (item: Item) => void;
  onConfirmAdd: (item: Item, qty: number) => void;
  onConfirmSpecialRateAdd: (item: Item, qty: number) => void;
  onRequestPo: (item: Item) => void;
  onCancelAdd: () => void;
  pendingAddItemId: number | null;
  totalInOrderQty: number;
  price: number;
  hasSpecialLine: boolean;
  poRequested: boolean;
}

function SpecialRateChip() {
  return (
    <span className="inline-flex items-center rounded-md bg-[var(--bg-accent-subtle)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--content-accent)]">
      special rate
    </span>
  );
}

function AliasCode({
  value,
  query,
  matchedField,
  placeholder,
}: {
  value: string;
  query: string;
  matchedField: MatchedField;
  placeholder?: boolean;
}) {
  const isMatched = matchedField === 'alias1' || matchedField === 'alias' || matchedField === 'name+alias';
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-md border px-2 py-1 font-mono text-[13px] font-semibold tracking-[0.04em] shrink-0 truncate ${
        placeholder
          ? 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-[var(--content-quaternary)]'
          : 'border-[var(--border-opaque)] bg-[var(--bg-tertiary)] text-[var(--content-primary)]'
      }`}
      aria-label={placeholder ? 'Product code (missing)' : 'Product code'}
    >
      {isMatched && !placeholder ? highlightText(value, query) : value}
    </span>
  );
}

type StockTone = 'positive' | 'warning' | 'negative' | 'neutral';

function getStockPresentation(stockQty: number | null | undefined): {
  label: string;
  detail?: string;
  tone: StockTone;
  canAdd: boolean;
} {
  if (typeof stockQty !== 'number' || Number.isNaN(stockQty)) {
    return {
      label: 'Stock unknown',
      tone: 'neutral',
      canAdd: true,
    };
  }

  if (stockQty <= 0) {
    return {
      label: 'Out of stock',
      tone: 'negative',
      canAdd: false,
    };
  }

  if (stockQty <= 5) {
    return {
      label: 'Low stock',
      detail: `${Math.floor(stockQty)} left`,
      tone: 'warning',
      canAdd: true,
    };
  }

  return {
    label: 'In stock',
    detail: `${Math.floor(stockQty)} available`,
    tone: 'positive',
    canAdd: true,
  };
}

function StockStatus({
  stockQty,
  poRequested,
}: {
  stockQty: number | null | undefined;
  poRequested: boolean;
}) {
  const status = getStockPresentation(stockQty);
  const toneClass =
    status.tone === 'positive'
      ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
      : status.tone === 'warning'
        ? 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]'
        : status.tone === 'negative'
          ? 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]'
          : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]';

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${toneClass}`}>
        {status.label}
      </span>
      {status.detail && (
        <span className="text-xs font-medium text-[var(--content-tertiary)]">
          {status.detail}
        </span>
      )}
      {poRequested && (
        <span className="text-xs font-semibold text-[var(--content-secondary)]">
          Purchase requested
        </span>
      )}
    </div>
  );
}

const ItemRow = memo(function ItemRow({
  result,
  query,
  onStartAdd,
  onConfirmAdd,
  onConfirmSpecialRateAdd,
  onRequestPo,
  onCancelAdd,
  pendingAddItemId,
  totalInOrderQty,
  price,
  hasSpecialLine,
  poRequested,
}: ItemRowProps) {
  const { item, matchedField } = result;
  const isPendingAdd = pendingAddItemId === item.id;
  const productCode = (item.alias1 ?? item.alias ?? '').toString().trim();
  const productCodeValue = productCode || '—';
  const stock = getStockPresentation(item.stock_qty);
  const canAdd = stock.canAdd;
  const showQtyEditor = isPendingAdd && canAdd;

  return (
    <li
      className={`rounded-2xl border bg-[var(--bg-secondary)] px-3 py-3.5 min-h-[104px] ${
        canAdd ? 'cursor-pointer border-[var(--border-subtle)]' : 'border-[var(--border-subtle)]'
      }`}
      onClick={() => {
        if (!isPendingAdd && canAdd) {
          onStartAdd(item);
        }
      }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <AliasCode
                value={productCodeValue}
                query={query}
                matchedField={matchedField}
                placeholder={!productCode}
              />
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-[22px] font-bold leading-none text-[var(--content-primary)]">
                {formatCurrency(price)}
              </p>
              {hasSpecialLine && (
                <div className="mt-2 flex justify-end">
                  <SpecialRateChip />
                </div>
              )}
            </div>
          </div>

          <p className="mt-2 text-[17px] font-semibold leading-snug text-[var(--content-primary)] line-clamp-2">
            {highlightText(item.name, query)}
          </p>

          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <StockStatus stockQty={item.stock_qty} poRequested={poRequested} />
          </div>

          {(totalInOrderQty > 0 || hasSpecialLine) && (
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              {totalInOrderQty > 0 && (
                <span className="text-xs font-medium text-[var(--content-tertiary)]">
                  {totalInOrderQty} in order
                </span>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 self-center">
          {showQtyEditor ? (
            <div className="flex items-center gap-1">
              <InlineQtyEditor
                value={1}
                open
                onConfirm={(qty) => onConfirmAdd(item, qty)}
                onCancel={onCancelAdd}
                min={1}
                max={item.stock_qty > 0 ? Math.floor(item.stock_qty) : undefined}
                secondaryAction={{
                  icon: <CurrencyInr size={18} weight="bold" />,
                  ariaLabel: `Add ${item.name} with special rate`,
                  onAction: (qty) => onConfirmSpecialRateAdd(item, qty),
                }}
              />
            </div>
          ) : canAdd ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartAdd(item);
              }}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--bg-accent)] text-[var(--content-on-color)] transition-transform hover:opacity-90 active:scale-95"
              aria-label="Add to cart"
            >
              <Plus size={20} weight="bold" />
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!poRequested) {
                  onRequestPo(item);
                }
              }}
              className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors ${
                poRequested
                  ? 'bg-[var(--bg-tertiary)] text-[var(--content-tertiary)]'
                  : 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] hover:opacity-90 active:scale-95'
              }`}
              aria-label={poRequested ? `Purchase already requested for ${item.name}` : `Request purchase for ${item.name}`}
              disabled={poRequested}
            >
              {poRequested ? 'PO requested' : 'Request PO'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.result.item.id === nextProps.result.item.id &&
    prevProps.query === nextProps.query &&
    prevProps.pendingAddItemId === nextProps.pendingAddItemId &&
    prevProps.totalInOrderQty === nextProps.totalInOrderQty &&
    prevProps.price === nextProps.price &&
    prevProps.hasSpecialLine === nextProps.hasSpecialLine &&
    prevProps.poRequested === nextProps.poRequested
  );
});

// ---------------------------------------------------------------------------
// ResultSection
// ---------------------------------------------------------------------------
function ResultSection({
  label,
  results,
  query,
  onStartAdd,
  onConfirmAdd,
  onConfirmSpecialRateAdd,
  onRequestPo,
  onCancelAdd,
  pendingAddItemId,
  getTotalInOrderQty,
  getPrice,
  hasSpecialLine,
  isPoRequested,
}: {
  label: string;
  results: SearchResult[];
  query: string;
  onStartAdd: (item: Item) => void;
  onConfirmAdd: (item: Item, qty: number) => void;
  onConfirmSpecialRateAdd: (item: Item, qty: number) => void;
  onRequestPo: (item: Item) => void;
  onCancelAdd: () => void;
  pendingAddItemId: number | null;
  getTotalInOrderQty: (id: number) => number;
  getPrice: (item: Item) => number;
  hasSpecialLine: (id: number) => boolean;
  isPoRequested: (item: Item) => boolean;
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
            pendingAddItemId={pendingAddItemId}
            onConfirmAdd={onConfirmAdd}
            onConfirmSpecialRateAdd={onConfirmSpecialRateAdd}
            onRequestPo={onRequestPo}
            onCancelAdd={onCancelAdd}
            totalInOrderQty={getTotalInOrderQty(r.item.id)}
            price={getPrice(r.item)}
            hasSpecialLine={hasSpecialLine(r.item.id)}
            poRequested={isPoRequested(r.item)}
            onStartAdd={onStartAdd}
          />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NewOrderPage
// ---------------------------------------------------------------------------
export default function NewOrderPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { data: items = [], isLoading: itemsLoading } = useItems();
  const {
    items: cartItems,
    addItem,
    totalCount,
    totalValue,
    selectedCustomer,
    setSelectedCustomer,
  } = useCart();

  const [query, setQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [isBrandSheetOpen, setIsBrandSheetOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [rateItem, setRateItem] = useState<Item | null>(null);
  const [rateQty, setRateQty] = useState(1);
  const [rateValue, setRateValue] = useState('');
  const [pendingAddItemId, setPendingAddItemId] = useState<number | null>(null);
  const [poRequestedKeys, setPoRequestedKeys] = useState<Set<string>>(() => new Set());
  const [moreVisible, setMoreVisible] = useState(INITIAL_MORE_VISIBLE);
  const searchRef = useRef<HTMLDivElement | null>(null);

  const focusSearchInput = (delayMs = 0) => {
    window.setTimeout(() => {
      requestAnimationFrame(() => {
        const input = searchRef.current?.querySelector('input:not([type="hidden"])') as HTMLInputElement | null;
        input?.focus();
      });
    }, delayMs);
  };

  const narrowIndex = useMemo(() => buildNarrowIndex(items), [items]);

  const brandOptions: BrandOption[] = useMemo(() => {
    return [...narrowIndex.itemCountByMainGroup.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [narrowIndex]);

  const subGroupsForBrand = useMemo(() => {
    if (!selectedBrand) return [];
    const gmap = narrowIndex.countsByBrandGroup.get(selectedBrand);
    if (!gmap) return [];
    return [...gmap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [narrowIndex, selectedBrand]);

  const effectiveQuery = query.trim();
  const isCodeMode = detectCodeLike(effectiveQuery);
  const deferredQuery = useDeferredValue(effectiveQuery);
  const isStale = deferredQuery !== effectiveQuery;
  const isSearchMode = isSearchFocused || effectiveQuery.length > 0;
  const activeFilterCount = (selectedBrand ? 1 : 0) + (selectedGroup ? 1 : 0);
  const activeFilterSummary = [selectedBrand, selectedGroup].filter(Boolean).join(' · ');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMoreVisible(INITIAL_MORE_VISIBLE);
  }, [deferredQuery]);

  // Build the search index ONCE from all items — brand/group filtering is done inside searchItems()
  const searchIndex = useMemo(() => buildSearchIndex(items), [items]);

  const searchResults = useMemo(() => {
    let results: SearchResult[] = [];
    if (deferredQuery) {
      // Align boosts with deferred results (same heuristic as detectedBrand, but on deferredQuery)
      let detectedForSearch: string | null = null;
      if (!selectedBrand) {
        const narrowForDeferred = buildNarrowSuggestions(
          narrowIndex,
          deferredQuery,
          selectedBrand,
          selectedGroup,
        );
        const brands = narrowForDeferred.filter(s => s.type === 'brand');
        if (brands.length === 1) {
          detectedForSearch = brands[0].value;
        } else if (brands.length >= 2 && brands[0].count > brands[1].count * 3) {
          detectedForSearch = brands[0].value;
        }
      }
      results = searchItems(
        deferredQuery,
        searchIndex,
        selectedBrand,
        selectedGroup,
        detectedForSearch,
      );
    } else if (selectedBrand) {
      const brandSet = searchIndex.brandGroups.get(selectedBrand);
      if (brandSet) {
        let indices = [...brandSet];
        if (selectedGroup) {
          const groupSet = searchIndex.parentGroups.get(selectedGroup);
          if (groupSet) {
            indices = indices.filter(i => groupSet.has(i));
          } else {
            indices = [];
          }
        }
        results = indices
          .slice(0, MAX_RESULTS)
          .map(i => ({
            item: searchIndex.all[i].item,
            score: 100,
            matchType: 'exact-name' as const,
            matchedField: 'name' as const,
          }));
      }
    }
    return results;
  }, [deferredQuery, searchIndex, selectedBrand, selectedGroup, narrowIndex]);

  // When browsing a brand with no query there's no meaningful "best match" split
  const bestMatches = useMemo(
    () => (deferredQuery ? searchResults.slice(0, 3).filter(r => r.score >= 80) : []),
    [searchResults, deferredQuery],
  );
  const bestMatchIds = useMemo(() => new Set(bestMatches.map(r => r.item.id)), [bestMatches]);
  const moreResults = useMemo(
    () => searchResults.filter(r => !bestMatchIds.has(r.item.id)),
    [searchResults, bestMatchIds],
  );
  const moreDisplayed = useMemo(() => moreResults.slice(0, moreVisible), [moreResults, moreVisible]);
  const hasMoreResults = moreResults.length > moreDisplayed.length;

  const cartQtyByItem = useMemo(() => {
    const totals = new Map<number, number>();
    for (const line of cartItems) {
      totals.set(line.item.id, (totals.get(line.item.id) ?? 0) + line.qty);
    }
    return totals;
  }, [cartItems]);

  const specialLineItemIds = useMemo(() => {
    const ids = new Set<number>();
    for (const line of cartItems) {
      if (line.specialRate !== null) ids.add(line.item.id);
    }
    return ids;
  }, [cartItems]);

  const getTotalInOrderQty = (id: number) => cartQtyByItem.get(id) ?? 0;
  const getPrice = (item: Item) => item.sales_price;
  const hasSpecialLine = (id: number) => specialLineItemIds.has(id);
  const getPoRequestKey = (item: Item) => `${selectedCustomer?.id ?? 'draft'}:${item.id}`;
  const isPoRequested = (item: Item) => poRequestedKeys.has(getPoRequestKey(item));

  const handleQueryChange = (value: string) => {
    if (value.trim()) {
      setPendingAddItemId(null);
    }
    setQuery(value);
  };

  const handleStartAdd = (item: Item) => {
    setPendingAddItemId(item.id);
  };

  const handleConfirmAdd = (item: Item, qty: number) => {
    addItem(item, qty);
    setPendingAddItemId(null);
    setQuery('');
    focusSearchInput(60);
  };

  const handleCancelAdd = () => {
    setPendingAddItemId(null);
    focusSearchInput(60);
  };

  const handleConfirmSpecialRateAdd = (item: Item, qty: number) => {
    setPendingAddItemId(null);
    setRateItem(item);
    setRateQty(qty);
    setRateValue('');
  };

  const handleRequestPo = (item: Item) => {
    setPendingAddItemId(null);
    setPoRequestedKeys(prev => {
      const next = new Set(prev);
      next.add(getPoRequestKey(item));
      return next;
    });
  };

  const handleRateSave = () => {
    if (!rateItem) return;
    const n = parseFloat(rateValue.replace(/,/g, ''));
    if (isNaN(n) || n < 0) return;
    addItem(rateItem, rateQty, n);
    setRateItem(null);
    setRateValue('');
    setQuery('');
    focusSearchInput(60);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {!isSearchMode && (
        <PageHeader
          title="New Order"
          action={
            totalCount > 0 ? (
              <button
                onClick={() => navigate('/sales/cart')}
                className="flex items-center gap-1.5 min-h-12 min-w-12 px-2 rounded-lg text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]"
              >
                <ShoppingCart size={22} weight="regular" />
                <span className="font-mono text-sm font-semibold">{totalCount}</span>
              </button>
            ) : null
          }
        />
      )}

      <div className="px-4 pb-4">
        {/* Sticky search + filters */}
        <div
          ref={searchRef}
          className={`sticky z-30 -mx-4 px-4 ${isSearchMode ? 'top-0 pt-2' : 'top-11 pt-1.5'} pb-2 space-y-1.5 bg-[var(--bg-primary)] border-b border-[var(--border-subtle)]`}
        >
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SearchInput
                placeholder="Search parts, name or code…"
                value={query}
                onChange={handleQueryChange}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                loading={itemsLoading}
                autoFocus
                debounceMs={0}
              />
            </div>
            <button
              type="button"
              onClick={() => setIsBrandSheetOpen(true)}
              className={`relative h-12 min-w-12 px-3 rounded-xl border transition-colors ${
                activeFilterCount > 0
                  ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                  : 'border-[var(--border-opaque)] bg-[var(--bg-secondary)] text-[var(--content-secondary)]'
              }`}
              aria-label={activeFilterCount > 0 ? `Filters active: ${activeFilterCount}` : 'Open filters'}
            >
              <FunnelSimple size={18} weight="bold" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[var(--bg-accent)] text-[var(--content-on-color)] text-[11px] font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
          {activeFilterSummary && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-3 py-2">
              <p className="text-sm text-[var(--content-secondary)] truncate">
                Filtered by <span className="text-[var(--content-primary)] font-medium">{activeFilterSummary}</span>
              </p>
              <button
                type="button"
                onClick={() => {
                  setSelectedBrand(null);
                  setSelectedGroup(null);
                }}
                className="text-sm font-medium text-[var(--bg-accent)] shrink-0"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Results area */}
        <div
          className={`space-y-4 transition-opacity duration-100 ${totalCount > 0 ? 'pb-32' : ''} ${isStale ? 'opacity-60' : 'opacity-100'}`}
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
              <div className="flex items-center justify-center gap-4">
                {selectedBrand && (
                  <button
                    onClick={() => {
                      setSelectedBrand(null);
                      setSelectedGroup(null);
                    }}
                    className="text-sm text-[var(--bg-accent)] underline"
                  >
                    Search all groups
                  </button>
                )}
                <button
                  onClick={() => setIsBrandSheetOpen(true)}
                  className="text-sm text-[var(--bg-accent)] underline"
                >
                  Open filters
                </button>
              </div>
            </div>
          ) : (
            <>
              <ResultSection
                label="Best match"
                results={bestMatches}
                query={effectiveQuery}
                onStartAdd={handleStartAdd}
                onConfirmAdd={handleConfirmAdd}
                onConfirmSpecialRateAdd={handleConfirmSpecialRateAdd}
                onRequestPo={handleRequestPo}
                onCancelAdd={handleCancelAdd}
                pendingAddItemId={pendingAddItemId}
                getTotalInOrderQty={getTotalInOrderQty}
                getPrice={getPrice}
                hasSpecialLine={hasSpecialLine}
                isPoRequested={isPoRequested}
              />
              <ResultSection
                label={bestMatches.length ? 'More results' : 'Results'}
                results={moreDisplayed}
                query={effectiveQuery}
                onStartAdd={handleStartAdd}
                onConfirmAdd={handleConfirmAdd}
                onConfirmSpecialRateAdd={handleConfirmSpecialRateAdd}
                onRequestPo={handleRequestPo}
                onCancelAdd={handleCancelAdd}
                pendingAddItemId={pendingAddItemId}
                getTotalInOrderQty={getTotalInOrderQty}
                getPrice={getPrice}
                hasSpecialLine={hasSpecialLine}
                isPoRequested={isPoRequested}
              />
              {hasMoreResults && (
                <button
                  type="button"
                  onClick={() =>
                    setMoreVisible(v => Math.min(v + MORE_RESULTS_PAGE, moreResults.length))
                  }
                  className="w-full py-3 rounded-xl text-sm font-semibold text-[var(--bg-accent)] bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)] active:scale-[0.99]"
                >
                  Show more ({moreResults.length - moreDisplayed.length} left)
                </button>
              )}
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
              {cartItems.length} item{cartItems.length !== 1 ? 's' : ''} · {totalCount} pcs
            </p>
            <p className="font-mono text-lg font-bold text-[var(--content-primary)]">
              {formatCurrency(totalValue)}
            </p>
          </div>
          <button
            onClick={() => navigate('/sales/cart')}
            className="flex items-center gap-1.5 min-h-12 px-4 rounded-xl bg-[var(--bg-accent)] text-[var(--content-on-color)] font-semibold hover:opacity-90 active:scale-95"
          >
            View Cart
            <CaretRight size={20} weight="bold" />
          </button>
        </div>
      )}

      {/* Special rate sheet */}
      <BottomSheet
        isOpen={!!rateItem}
        onClose={() => {
          setRateItem(null);
          focusSearchInput(60);
        }}
        title={rateItem ? `Special rate: ${rateItem.name}` : ''}
      >
        {rateItem && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--content-tertiary)]">
              Qty: <span className="font-mono">{rateQty}</span> · Default: {formatCurrency(rateItem.sales_price)}
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
                onClick={() => {
                  setRateItem(null);
                  focusSearchInput(60);
                }}
                className="flex-1 h-12 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-secondary)] font-semibold hover:opacity-90"
              >
                Cancel
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
        title="Filters"
      >
        <BrandFilterSheetContent
          brands={brandOptions}
          selectedBrand={selectedBrand}
          groups={subGroupsForBrand}
          selectedGroup={selectedGroup}
          onSelect={brand => {
            setSelectedBrand(brand);
            setSelectedGroup(null);
          }}
          onSelectGroup={setSelectedGroup}
        />
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => {
              setSelectedBrand(null);
              setSelectedGroup(null);
            }}
            className="flex-1 h-12 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-secondary)] font-semibold"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setIsBrandSheetOpen(false)}
            className="flex-1 h-12 rounded-xl bg-[var(--bg-accent)] text-[var(--content-on-color)] font-semibold"
          >
            Done
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
