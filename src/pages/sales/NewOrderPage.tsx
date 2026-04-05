import {
  useState,
  useMemo,
  useDeferredValue,
  useRef,
  useEffect,
  useLayoutEffect,
  memo,
  useCallback,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  ShoppingCart,
  CaretRight,
  CaretLeft,
  Check,
  FunnelSimple,
  Trash,
  CurrencyInr,
} from '@phosphor-icons/react';
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
import { formatBrandLabel, formatCurrency, formatShortDate } from '../../utils/formatters';
import { supabase } from '../../lib/supabase/client';
import {
  PageHeader,
  SearchInput,
  BottomSheet,
  Skeleton,
  NumberStepper,
  FilterChip,
} from '../../components/shared';
import type { Item, Customer } from '../../types';
import {
  formatStockQty,
  getStockTier,
  stockPrimaryLabel,
  stockAfterOrderLine,
  type StockTier,
} from '../../lib/stockDisplay';

/** First paint of "More results" before expanding; search still returns up to MAX_RESULTS. */
const INITIAL_MORE_VISIBLE = 36;
const MORE_RESULTS_PAGE = 36;
const RECENT_SEARCHES_KEY = 'paspl_sales_recent_searches';
const MAX_RECENT_SEARCHES = 6;
const MAX_POPULAR_QUICK_FILTERS = 8;
/** Set to true to restore funnel, chips, filter sheet, and popular category shortcuts. */
const SHOW_SEARCH_FILTERS = false;

interface BrandOption {
  name: string;
  count: number;
}

type SortMode = 'relevance' | 'price-asc' | 'price-desc' | 'name-asc';

interface SearchFilterDraft {
  brand: string | null;
  group: string | null;
  sort: SortMode;
  inStockOnly: boolean;
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

function SearchFilterSheetContent({
  brands,
  groups,
  draft,
  onDraftChange,
}: {
  brands: BrandOption[];
  groups: BrandOption[];
  draft: SearchFilterDraft;
  onDraftChange: (next: SearchFilterDraft) => void;
}) {
  const [search, setSearch] = useState('');
  const sortOptions: { value: SortMode; label: string; helper: string }[] = [
    { value: 'relevance', label: 'Best match', helper: 'Smart ranking for typed queries' },
    { value: 'price-asc', label: 'Price: Low to High', helper: 'Surface lower-price items first' },
    { value: 'price-desc', label: 'Price: High to Low', helper: 'See premium items first' },
    { value: 'name-asc', label: 'Name A-Z', helper: 'Helpful for browsing within a filter' },
  ];

  const filtered = useMemo(
    () =>
      !search
        ? brands
        : brands.filter(b => b.name.toLowerCase().includes(search.toLowerCase())),
    [brands, search],
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="type-heading-m text-[var(--content-primary)]">Sort</h3>
          <p className="type-caption text-[var(--content-tertiary)]">Applied after search ranking</p>
        </div>
        <div className="space-y-2">
          {sortOptions.map((option) => {
            const selected = draft.sort === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onDraftChange({ ...draft, sort: option.value })}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                  selected
                    ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-primary)]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="type-body-sm-strong text-[var(--content-primary)]">{option.label}</p>
                    <p className="type-caption text-[var(--content-tertiary)]">{option.helper}</p>
                  </div>
                  <span
                    className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border ${
                      selected
                        ? 'border-[var(--bg-accent)] text-[var(--bg-accent)]'
                        : 'border-[var(--border-opaque)] text-transparent'
                    }`}
                    aria-hidden="true"
                  >
                    <Check size={12} weight="bold" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="type-heading-m text-[var(--content-primary)]">Filter</h3>
        <button
          type="button"
          onClick={() => onDraftChange({ ...draft, inStockOnly: !draft.inStockOnly })}
          className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
            draft.inStockOnly
              ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-primary)]'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="type-body-sm-strong text-[var(--content-primary)]">In stock only</p>
              <p className="type-caption text-[var(--content-tertiary)]">Hide items with zero available stock</p>
            </div>
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                draft.inStockOnly
                  ? 'border-[var(--bg-accent)] bg-[var(--bg-accent)] text-[var(--content-on-color)]'
                  : 'border-[var(--border-opaque)] text-transparent'
              }`}
              aria-hidden="true"
            >
              <Check size={12} weight="bold" />
            </span>
          </div>
        </button>
      </section>

      <section className="space-y-3">
        <h3 className="type-heading-m text-[var(--content-primary)]">Brand</h3>
        <input
          type="text"
          placeholder="Search brands…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="type-body-sm w-full h-11 rounded-xl border-none bg-[var(--bg-tertiary)] px-3 text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-subtle)]"
        />
        <div className="max-h-[34vh] overflow-y-auto -mx-1 pr-1 space-y-1">
          <button
            type="button"
            onClick={() => onDraftChange({ ...draft, brand: null, group: null })}
            className="type-body-sm flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)]"
          >
            <span>All brands</span>
            <span
              className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                draft.brand === null
                  ? 'border-[var(--bg-accent)] text-[var(--bg-accent)]'
                  : 'border-[var(--border-opaque)] text-transparent'
              }`}
              aria-hidden="true"
            >
              <Check size={12} weight="bold" />
            </span>
          </button>
          {filtered.map((brand) => {
            const selected = draft.brand === brand.name;
            return (
              <button
                key={brand.name}
                type="button"
                onClick={() => onDraftChange({ ...draft, brand: brand.name, group: null })}
                className="type-body-sm flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)]"
              >
                <span>{formatBrandLabel(brand.name)}</span>
                <div className="flex items-center gap-2">
                  <span className="type-caption font-mono text-[var(--content-quaternary)]">{brand.count}</span>
                  <span
                    className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                      selected
                        ? 'border-[var(--bg-accent)] text-[var(--bg-accent)]'
                        : 'border-[var(--border-opaque)] text-transparent'
                    }`}
                    aria-hidden="true"
                  >
                    <Check size={12} weight="bold" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {draft.brand && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="type-heading-m text-[var(--content-primary)]">Sub-category</h3>
            {draft.group && (
              <button
                type="button"
                onClick={() => onDraftChange({ ...draft, group: null })}
                className="type-body-sm font-medium text-[var(--bg-accent)]"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {groups.length === 0 ? (
              <p className="type-body-sm text-[var(--content-tertiary)]">No sub-categories for this brand</p>
            ) : (
              groups.map((group) => (
                <button
                  key={group.name}
                  type="button"
                  onClick={() =>
                    onDraftChange({
                      ...draft,
                      group: draft.group === group.name ? null : group.name,
                    })
                  }
                  className={`type-body-sm h-10 rounded-full px-3 font-medium transition-colors ${
                    draft.group === group.name
                      ? 'bg-[var(--bg-accent)] text-[var(--content-on-color)]'
                      : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
                  }`}
                >
                  {group.name}
                </button>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function SearchDiscoveryPanel({
  recentSearches,
  popularSearches,
  onSearchPick,
  onPopularFilterPick,
  onClearHistory,
}: {
  recentSearches: string[];
  popularSearches: string[];
  onSearchPick: (value: string) => void;
  onPopularFilterPick: (value: string) => void;
  onClearHistory: () => void;
}) {
  return (
    <div className="space-y-6 pt-3">
      {recentSearches.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="type-heading-l text-[var(--content-primary)]">Recent searches</h2>
            <button
              type="button"
              onClick={onClearHistory}
              className="type-body-sm font-medium text-[var(--content-secondary)]"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => onSearchPick(term)}
                className="type-body-sm rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 font-medium text-[var(--content-secondary)] shadow-sm"
              >
                {term}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="type-heading-l text-[var(--content-primary)]">Popular categories</h2>
          <p className="type-body-sm text-[var(--content-tertiary)]">Quick ways to jump into browsing without typing</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {popularSearches.map((term) => (
            <button
              key={term}
              type="button"
              onClick={() => onPopularFilterPick(term)}
              className="type-body-sm rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 font-medium text-[var(--content-primary)] shadow-sm"
            >
              {formatBrandLabel(term)}
            </button>
          ))}
        </div>
      </section>
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
            <h3 className="type-overline text-[var(--content-tertiary)]">
              Trending
            </h3>
            <div className="space-y-2">
              {trendingItems.map(({ item, totalOrderCount }) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl bg-[var(--bg-secondary)]"
                >
                  <div className="min-w-0">
                    <p className="type-body-strong truncate text-[var(--content-primary)]">
                      {item.name}
                    </p>
                    <p className="type-caption text-[var(--content-tertiary)]">
                      Ordered {totalOrderCount} times
                    </p>
                  </div>
                  <button
                    type="button"
                    className="type-body-sm-strong h-9 shrink-0 rounded-full bg-[var(--bg-accent)] px-3 text-[var(--content-on-color)] active:scale-95"
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
        <h3 className="type-overline mt-1 text-[var(--content-tertiary)]">
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
                <p className="type-body-strong line-clamp-2 leading-snug text-[var(--content-primary)]">
                  {c.customer_name}
                </p>
                <p className="type-caption text-[var(--content-secondary)]">
                  {c.order_count} order{c.order_count === 1 ? '' : 's'}
                </p>
                <p className="type-caption mt-1 text-[var(--content-tertiary)]">
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
            <h3 className="type-overline text-[var(--content-tertiary)]">
              Pending from last orders
            </h3>
            <p className="type-caption mt-1 text-[var(--content-tertiary)]">
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
                  <p className="type-body-sm-strong truncate text-[var(--content-primary)]">
                    {row.item.name}
                  </p>
                  <p className="type-caption mt-1 text-[var(--content-tertiary)]">
                    Pending last time:{' '}
                    <span className="type-caption-strong font-mono">{row.qty}</span> pcs
                  </p>
                </div>
                <span className="type-caption-strong text-[var(--bg-accent)]">
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
            <h3 className="type-overline text-[var(--content-tertiary)]">
              Quick Reorder: {activeCustomerName}
            </h3>
            {quickReorderItems.length > 0 && (
              <p className="type-caption mt-1 text-[var(--content-tertiary)]">
                Based on past orders
              </p>
            )}
          </div>

          {customerTopItemsLoading && (
            <p className="type-caption text-[var(--content-tertiary)]">Loading suggestions…</p>
          )}

          {!customerTopItemsLoading && quickReorderItems.length === 0 && (
            <p className="type-caption text-[var(--content-tertiary)]">
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
                    <p className="type-body-sm-strong whitespace-normal break-words line-clamp-2 leading-snug text-[var(--content-primary)]">
                      {row.item.name}
                    </p>
                    <p className="type-caption mt-1 text-[var(--content-tertiary)]">
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
              className="type-body-sm-strong flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--bg-accent)] text-[var(--content-on-color)] disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
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
              className={`type-body-sm-strong flex h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-secondary)] active:scale-95 ${
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
          <h3 className="type-overline text-[var(--content-tertiary)]">
            Trending
          </h3>
          <div className="space-y-2">
            {trendingItems.map(({ item, totalOrderCount }) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 px-3 py-3 rounded-xl bg-[var(--bg-secondary)]"
              >
                <div className="min-w-0">
                  <p className="type-body-strong truncate text-[var(--content-primary)]">
                    {item.name}
                  </p>
                  <p className="type-caption text-[var(--content-tertiary)]">
                    Ordered {totalOrderCount} times
                  </p>
                </div>
                <button
                  type="button"
                  className="type-body-sm-strong h-9 shrink-0 rounded-full bg-[var(--bg-accent)] px-3 text-[var(--content-on-color)] active:scale-95"
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
  onCancelAdd: () => void;
  pendingAddItemId: number | null;
  totalInOrderQty: number;
  price: number;
  hasSpecialLine: boolean;
  justAdded: boolean;
}

/** Same block size as `AliasCode` (px-3 py-1.5, 12px semibold) so SKU + special rate read as one chip row. */
function SpecialRateChip() {
  return (
    <span className="type-caption-strong inline-flex shrink-0 items-center leading-none rounded-full bg-[var(--bg-accent-subtle)] px-3 py-1.5 text-[var(--content-accent)]">
      Special rate
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
      className={`type-caption-strong inline-flex max-w-full shrink-0 items-center rounded-full px-3 py-1.5 font-mono tracking-[0.04em] truncate ${
        placeholder
          ? 'bg-[var(--bg-tertiary)] text-[var(--content-quaternary)]'
          : 'bg-[var(--bg-tertiary)] text-[var(--content-primary)]'
      }`}
      aria-label={placeholder ? 'Product code (missing)' : 'Product code'}
    >
      {isMatched && !placeholder ? highlightText(value, query) : value}
    </span>
  );
}

/** Same geometry as `StatusBadge`: `w-1.5 h-1.5` + solid fills (see StatusBadge.tsx). */
function StockStatusDot({ tier }: { tier: StockTier }) {
  const dotClass =
    tier === 'ok'
      ? 'bg-[var(--content-positive)]'
      : tier === 'low'
        ? 'bg-[var(--content-warning)]'
        : tier === 'out'
          ? 'bg-[var(--bg-negative)]'
          : 'bg-[var(--content-quaternary)]';

  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />;
}

/** Single-line stock while editing qty: avoids duplicating “X in stock” + a separate red warning. */
function PendingItemStockLine({
  stockQty,
  totalInOrderQty,
  draftQty,
}: {
  stockQty: number | null | undefined;
  totalInOrderQty: number;
  draftQty: number;
}) {
  const tier = getStockTier(stockQty);
  const primary = stockPrimaryLabel(stockQty, tier);
  const primaryTextClass =
    tier === 'ok'
      ? 'text-[#047857]'
      : tier === 'low'
        ? 'text-[#b45309]'
        : tier === 'out'
          ? 'text-[#b91c1c]'
          : 'text-[var(--content-tertiary)]';

  if (tier === 'unknown' || stockQty == null || !Number.isFinite(Number(stockQty))) {
    return (
      <p className="type-caption-strong flex min-w-0 items-center gap-1.5 leading-snug">
        <StockStatusDot tier={tier} />
        <span className={`min-w-0 ${primaryTextClass}`}>{primary}</span>
      </p>
    );
  }

  if (tier === 'out') {
    const combined = totalInOrderQty + draftQty;
    const body = (
      <>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--bg-warning)]" aria-hidden />
        <span className="min-w-0 text-[var(--content-warning)]">
          Out of stock
          {combined > 0 && (
            <span className="font-semibold">
              {' '}
              · {formatStockQty(draftQty)} in this add{totalInOrderQty > 0 ? ` · ${formatStockQty(totalInOrderQty)} already in cart` : ''} → PO at checkout
            </span>
          )}
        </span>
      </>
    );
    return (
      <div
        className="rounded-lg border border-[color-mix(in_srgb,var(--border-warning)_40%,var(--border-subtle))] bg-[var(--bg-warning-subtle)] px-2 py-1.5"
        role="status"
      >
        <p className="type-caption-strong flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-snug">
          {body}
        </p>
      </div>
    );
  }

  const S = Number(stockQty);
  const combined = totalInOrderQty + draftQty;
  const overBy = combined > S ? combined - S : 0;

  const body = (
    <>
      {overBy > 0 ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--bg-warning)]" aria-hidden />
      ) : (
        <StockStatusDot tier={tier} />
      )}
      <span
        className={
          overBy > 0
            ? 'min-w-0 text-[var(--content-warning)]'
            : `min-w-0 ${primaryTextClass}`
        }
      >
        {formatStockQty(S)} in stock
        {totalInOrderQty > 0 && (
          <span
            className={
              overBy > 0
                ? 'font-medium text-[color-mix(in_srgb,var(--content-warning)_82%,var(--content-secondary))]'
                : 'font-medium text-[var(--content-secondary)]'
            }
          >
            {' '}
            · {formatStockQty(totalInOrderQty)} in cart
          </span>
        )}
        {overBy > 0 && (
          <span className="font-semibold">
            {' '}
            · Short by {formatStockQty(overBy)}, request PO at checkout
          </span>
        )}
      </span>
    </>
  );

  if (overBy > 0) {
    return (
      <div
        className="rounded-lg border border-[color-mix(in_srgb,var(--border-warning)_40%,var(--border-subtle))] bg-[var(--bg-warning-subtle)] px-2 py-1.5"
        role="status"
      >
        <p className="type-caption-strong flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-snug">
          {body}
        </p>
      </div>
    );
  }

  return (
    <p className="type-caption-strong flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-snug">
      {body}
    </p>
  );
}

function ItemStockBlock({
  stockQty,
  totalInOrderQty,
}: {
  stockQty: number | null | undefined;
  totalInOrderQty: number;
}) {
  const tier = getStockTier(stockQty);
  const primary = stockPrimaryLabel(stockQty, tier);
  const secondary =
    tier !== 'unknown' && tier !== 'out' && stockQty != null && Number.isFinite(Number(stockQty))
      ? stockAfterOrderLine(Number(stockQty), totalInOrderQty, tier)
      : null;

  const primaryTextClass =
    tier === 'ok'
      ? 'text-[#047857]'
      : tier === 'low'
        ? 'text-[#b45309]'
        : tier === 'out'
          ? 'text-[#b91c1c]'
          : 'text-[var(--content-tertiary)]';

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="type-caption-strong flex min-w-0 items-center gap-1.5 leading-none">
        <StockStatusDot tier={tier} />
        <span className={`min-w-0 ${primaryTextClass}`}>{primary}</span>
      </p>
      {secondary &&
        (secondary.variant === 'shortfall' ? (
          <div className="mt-1 rounded-lg border border-[color-mix(in_srgb,var(--border-warning)_40%,var(--border-subtle))] bg-[var(--bg-warning-subtle)] px-2 py-1.5">
            <p className="type-caption-strong leading-snug text-[var(--content-warning)]">{secondary.text}</p>
          </div>
        ) : (
          <p
            className={`type-caption pl-3 font-medium leading-[1.35] ${
              secondary.tone === 'negative'
                ? 'text-[#b91c1c]'
                : 'text-[var(--content-secondary)]'
            }`}
          >
            {secondary.text}
          </p>
        ))}
    </div>
  );
}

/** Only mounts while this row is in “pending add” mode so qty state always starts at 1 (no setState in an effect). */
const ItemRowPendingAddContent = memo(function ItemRowPendingAddContent({
  item,
  query,
  matchedField,
  productCodeValue,
  hasProductCode,
  price,
  totalInOrderQty,
  hasSpecialLine,
  onConfirmAdd,
  onConfirmSpecialRateAdd,
  onCancelAdd,
}: {
  item: Item;
  query: string;
  matchedField: MatchedField;
  productCodeValue: string;
  hasProductCode: boolean;
  price: number;
  totalInOrderQty: number;
  hasSpecialLine: boolean;
  onConfirmAdd: (item: Item, qty: number) => void;
  onConfirmSpecialRateAdd: (item: Item, qty: number) => void;
  onCancelAdd: () => void;
}) {
  const qtyInputRef = useRef<HTMLInputElement | null>(null);
  const [draftQtyInput, setDraftQtyInput] = useState('1');

  const getDraftQty = useCallback(() => {
    const parsed = parseInt(draftQtyInput.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return parsed;
  }, [draftQtyInput]);

  useLayoutEffect(() => {
    qtyInputRef.current?.focus();
    qtyInputRef.current?.select();
  }, [item.id]);

  const handleConfirmQty = useCallback(() => {
    onConfirmAdd(item, getDraftQty());
  }, [getDraftQty, item, onConfirmAdd]);

  const handleSpecialRate = useCallback(() => {
    onConfirmSpecialRateAdd(item, getDraftQty());
  }, [getDraftQty, item, onConfirmSpecialRateAdd]);

  const draftQty = getDraftQty();

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <AliasCode
              value={productCodeValue}
              query={query}
              matchedField={matchedField}
              placeholder={!hasProductCode}
            />
            {hasSpecialLine && <SpecialRateChip />}
          </div>
          <p className="type-body-sm-strong line-clamp-2 break-words leading-[1.35] text-[var(--content-primary)]">
            {highlightText(item.name, query)}
          </p>
          <PendingItemStockLine
            stockQty={item.stock_qty}
            totalInOrderQty={totalInOrderQty}
            draftQty={draftQty}
          />
        </div>
        <p className="type-caption shrink-0 pt-0.5 text-right font-mono leading-none text-[var(--content-tertiary)]">
          {formatCurrency(price)}
        </p>
      </div>

      <div className="mt-2.5 grid grid-rows-[1fr] opacity-100 translate-y-0 transition-[grid-template-rows,opacity,transform,margin-top,padding-top] duration-200 ease-out">
        <div className="overflow-hidden">
          <div className="border-t border-[var(--border-subtle)] pt-3">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSpecialRate();
                }}
                className="type-body-sm-strong inline-flex min-h-9 items-center gap-1.5 rounded-full px-0 text-[var(--content-accent)]"
                aria-label={`${hasSpecialLine ? 'Edit' : 'Set'} special rate for ${item.name}`}
              >
                <CurrencyInr size={14} weight="bold" />
                {hasSpecialLine ? 'Edit rate' : 'Special rate'}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancelAdd();
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] hover:opacity-90"
                  aria-label={`Cancel adding ${item.name}`}
                >
                  <Trash size={18} />
                </button>

                <input
                  ref={qtyInputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={draftQtyInput}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraftQtyInput(e.target.value.replace(/[^\d]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      handleConfirmQty();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      onCancelAdd();
                    }
                  }}
                  aria-label="Quantity"
                  className="type-heading-m h-11 w-14 rounded-[14px] border border-[var(--bg-accent)] bg-[var(--bg-secondary)] text-center font-mono text-[var(--content-primary)] outline-none focus:ring-1 focus:ring-[var(--bg-accent)]"
                />

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleConfirmQty();
                  }}
                  className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[var(--bg-accent)] text-[var(--content-on-color)] hover:opacity-90"
                  aria-label={`Add ${item.name}`}
                >
                  <Check size={18} weight="bold" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

const ItemRow = memo(function ItemRow({
  result,
  query,
  onStartAdd,
  onConfirmAdd,
  onConfirmSpecialRateAdd,
  onCancelAdd,
  pendingAddItemId,
  totalInOrderQty,
  price,
  hasSpecialLine,
  justAdded,
}: ItemRowProps) {
  const { item, matchedField } = result;
  const isPendingAdd = pendingAddItemId === item.id;
  const productCode = (item.alias1 ?? item.alias ?? '').toString().trim();
  const productCodeValue = productCode || '—';
  const showQtyEditor = isPendingAdd;
  const isOutOfStock = getStockTier(item.stock_qty) === 'out';

  return (
    <li
      className={`overflow-hidden rounded-2xl border bg-[var(--bg-secondary)] px-3 py-2.5 transition-[border-color,box-shadow] duration-200 ease-out cursor-pointer ${
        showQtyEditor
          ? 'border-[var(--bg-accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--bg-accent)_12%,transparent)]'
          : isOutOfStock
            ? 'border-[color-mix(in_srgb,var(--border-warning)_45%,var(--border-subtle))]'
            : 'border-[var(--border-subtle)]'
      }`}
      onClick={() => {
        if (!isPendingAdd) {
          onStartAdd(item);
        }
      }}
    >
      {showQtyEditor ? (
        <ItemRowPendingAddContent
          item={item}
          query={query}
          matchedField={matchedField}
          productCodeValue={productCodeValue}
          hasProductCode={!!productCode}
          price={price}
          totalInOrderQty={totalInOrderQty}
          hasSpecialLine={hasSpecialLine}
          onConfirmAdd={onConfirmAdd}
          onConfirmSpecialRateAdd={onConfirmSpecialRateAdd}
          onCancelAdd={onCancelAdd}
        />
      ) : (
        <div className="flex min-w-0 items-center gap-x-3">
          <div className="min-w-0 flex flex-1 flex-col gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <AliasCode
                value={productCodeValue}
                query={query}
                matchedField={matchedField}
                placeholder={!productCode}
              />
              {hasSpecialLine && <SpecialRateChip />}
            </div>

            <p className="type-body-sm-strong line-clamp-2 break-words leading-[1.35] text-[var(--content-primary)]">
              {highlightText(item.name, query)}
            </p>

            <ItemStockBlock stockQty={item.stock_qty} totalInOrderQty={totalInOrderQty} />

            {justAdded && (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="type-caption-strong inline-flex items-center gap-1 rounded-full bg-[var(--bg-positive-subtle)] px-3 py-1.5 leading-none text-[var(--content-positive)]">
                  <Check size={12} weight="bold" />
                  Added
                </span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end justify-center gap-2 self-stretch">
            <p className="type-caption text-right font-mono leading-none text-[var(--content-tertiary)]">
              {formatCurrency(price)}
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onStartAdd(item);
              }}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm transition-all duration-200 active:scale-95 ${
                isOutOfStock
                  ? 'bg-[var(--bg-warning)] text-[var(--content-on-color)] hover:opacity-95'
                  : justAdded
                    ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] hover:opacity-95'
                    : 'bg-[var(--bg-accent)] text-[var(--content-on-color)] hover:opacity-95'
              }`}
              aria-label={isOutOfStock ? 'Add to purchase order' : 'Add to cart'}
            >
              {justAdded ? <Check size={18} weight="bold" /> : <Plus size={20} weight="bold" />}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.result.item.id === nextProps.result.item.id &&
    prevProps.result.item.stock_qty === nextProps.result.item.stock_qty &&
    prevProps.query === nextProps.query &&
    prevProps.pendingAddItemId === nextProps.pendingAddItemId &&
    prevProps.totalInOrderQty === nextProps.totalInOrderQty &&
    prevProps.price === nextProps.price &&
    prevProps.hasSpecialLine === nextProps.hasSpecialLine &&
    prevProps.justAdded === nextProps.justAdded
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
  onCancelAdd,
  pendingAddItemId,
  getTotalInOrderQty,
  getPrice,
  hasSpecialLine,
  isJustAdded,
}: {
  label: string;
  results: SearchResult[];
  query: string;
  onStartAdd: (item: Item) => void;
  onConfirmAdd: (item: Item, qty: number) => void;
  onConfirmSpecialRateAdd: (item: Item, qty: number) => void;
  onCancelAdd: () => void;
  pendingAddItemId: number | null;
  getTotalInOrderQty: (id: number) => number;
  getPrice: (item: Item) => number;
  hasSpecialLine: (id: number) => boolean;
  isJustAdded: (id: number) => boolean;
}) {
  if (!results.length) return null;
  return (
    <div className="space-y-2">
      <p className="type-overline px-0.5 text-[var(--content-tertiary)]">
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
            onCancelAdd={onCancelAdd}
            totalInOrderQty={getTotalInOrderQty(r.item.id)}
            price={getPrice(r.item)}
            hasSpecialLine={hasSpecialLine(r.item.id)}
            justAdded={isJustAdded(r.item.id)}
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
  const { userName } = useAuth();
  const { data: items = [], isLoading: itemsLoading } = useItems();
  const {
    items: cartItems,
    addItem,
    totalCount,
    totalValue,
    setSelectedCustomer,
  } = useCart();

  const [query, setQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [isBrandSheetOpen, setIsBrandSheetOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [rateItem, setRateItem] = useState<Item | null>(null);
  const [rateQty, setRateQty] = useState(1);
  const [rateValue, setRateValue] = useState('');
  const [pendingAddItemId, setPendingAddItemId] = useState<number | null>(null);
  const [recentlyAddedItemId, setRecentlyAddedItemId] = useState<number | null>(null);
  const [cartPulse, setCartPulse] = useState(false);
  const [moreVisible, setMoreVisible] = useState(INITIAL_MORE_VISIBLE);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [draftFilters, setDraftFilters] = useState<SearchFilterDraft>({
    brand: null,
    group: null,
    sort: 'relevance',
    inStockOnly: false,
  });
  const searchRef = useRef<HTMLDivElement | null>(null);
  const addedFeedbackTimeoutRef = useRef<number | null>(null);
  const cartPulseTimeoutRef = useRef<number | null>(null);

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

  const draftSubGroupsForBrand = useMemo(() => {
    if (!draftFilters.brand) return [];
    const gmap = narrowIndex.countsByBrandGroup.get(draftFilters.brand);
    if (!gmap) return [];
    return [...gmap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [draftFilters.brand, narrowIndex]);

  const effectiveQuery = query.trim();
  const isCodeMode = detectCodeLike(effectiveQuery);
  const deferredQuery = useDeferredValue(effectiveQuery);
  const isStale = deferredQuery !== effectiveQuery;
  const sortLabel = useMemo(() => {
    switch (sortMode) {
      case 'price-asc':
        return 'Price: Low to High';
      case 'price-desc':
        return 'Price: High to Low';
      case 'name-asc':
        return 'Name A-Z';
      default:
        return 'Best match';
    }
  }, [sortMode]);
  const activeFilterCount =
    (selectedBrand ? 1 : 0) +
    (selectedGroup ? 1 : 0) +
    (inStockOnly ? 1 : 0) +
    (sortMode !== 'relevance' ? 1 : 0);
  const draftFilterCount =
    (draftFilters.brand ? 1 : 0) +
    (draftFilters.group ? 1 : 0) +
    (draftFilters.inStockOnly ? 1 : 0) +
    (draftFilters.sort !== 'relevance' ? 1 : 0);
  const activeFilterSummary = [
    selectedBrand ? formatBrandLabel(selectedBrand) : null,
    selectedGroup,
    inStockOnly ? 'In stock' : null,
    sortMode !== 'relevance' ? sortLabel : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const isSearchMode = isSearchFocused || effectiveQuery.length > 0 || activeFilterCount > 0;
  const popularQuickFilters = useMemo(
    () => brandOptions.slice(0, MAX_POPULAR_QUICK_FILTERS).map((brand) => brand.name),
    [brandOptions],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMoreVisible(INITIAL_MORE_VISIBLE);
  }, [deferredQuery]);

  useEffect(() => {
    return () => {
      if (addedFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(addedFeedbackTimeoutRef.current);
      }
      if (cartPulseTimeoutRef.current !== null) {
        window.clearTimeout(cartPulseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`${RECENT_SEARCHES_KEY}:${userName ?? 'guest'}`);
      if (!saved) return;
      const parsed = JSON.parse(saved) as unknown;
      if (Array.isArray(parsed)) {
        setRecentSearches(parsed.filter((value): value is string => typeof value === 'string'));
      }
    } catch {
      setRecentSearches([]);
    }
  }, [userName]);

  useEffect(() => {
    if (!deferredQuery || deferredQuery.length < 2) return;
    setRecentSearches((current) => {
      const next = [deferredQuery, ...current.filter((entry) => entry !== deferredQuery)].slice(0, MAX_RECENT_SEARCHES);
      try {
        window.localStorage.setItem(`${RECENT_SEARCHES_KEY}:${userName ?? 'guest'}`, JSON.stringify(next));
      } catch {
        // Ignore storage failures and keep in-memory history.
      }
      return next;
    });
  }, [deferredQuery, userName]);

  useEffect(() => {
    if (!isBrandSheetOpen) {
      setDraftFilters({
        brand: selectedBrand,
        group: selectedGroup,
        sort: sortMode,
        inStockOnly,
      });
    }
  }, [isBrandSheetOpen, selectedBrand, selectedGroup, sortMode, inStockOnly]);

  // Build the search index ONCE from all items — brand/group filtering is done inside searchItems()
  const searchIndex = useMemo(() => buildSearchIndex(items), [items]);

  const rawSearchResults = useMemo(() => {
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

  const searchResults = useMemo(() => {
    let results = rawSearchResults;

    if (inStockOnly) {
      results = results.filter((result) => result.item.stock_qty > 0);
    }

    if (sortMode === 'relevance') {
      return results;
    }

    return [...results].sort((left, right) => {
      if (sortMode === 'price-asc') {
        return left.item.sales_price - right.item.sales_price;
      }
      if (sortMode === 'price-desc') {
        return right.item.sales_price - left.item.sales_price;
      }
      return left.item.name.localeCompare(right.item.name);
    });
  }, [rawSearchResults, inStockOnly, sortMode]);

  // When browsing a brand with no query there's no meaningful "best match" split
  const bestMatches = useMemo(
    () => (deferredQuery && sortMode === 'relevance' ? searchResults.slice(0, 3).filter(r => r.score >= 80) : []),
    [searchResults, deferredQuery, sortMode],
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
  const isJustAdded = (id: number) => recentlyAddedItemId === id;

  const clearAddedFeedback = () => {
    if (addedFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(addedFeedbackTimeoutRef.current);
      addedFeedbackTimeoutRef.current = null;
    }
    setRecentlyAddedItemId(null);
  };

  const showAddedFeedback = (itemId: number) => {
    setRecentlyAddedItemId(itemId);
    setCartPulse(true);
    if (addedFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(addedFeedbackTimeoutRef.current);
    }
    if (cartPulseTimeoutRef.current !== null) {
      window.clearTimeout(cartPulseTimeoutRef.current);
    }
    addedFeedbackTimeoutRef.current = window.setTimeout(() => {
      setRecentlyAddedItemId(null);
      addedFeedbackTimeoutRef.current = null;
    }, 900);
    cartPulseTimeoutRef.current = window.setTimeout(() => {
      setCartPulse(false);
      cartPulseTimeoutRef.current = null;
    }, 450);
  };

  const handleQueryChange = (value: string) => {
    if (value.trim()) {
      setPendingAddItemId(null);
    }
    clearAddedFeedback();
    setQuery(value);
  };

  const clearAllFilters = useCallback(() => {
    setSelectedBrand(null);
    setSelectedGroup(null);
    setSortMode('relevance');
    setInStockOnly(false);
  }, []);

  const handleBackFromSearch = useCallback(() => {
    clearAddedFeedback();
    setIsBrandSheetOpen(false);
    if (effectiveQuery) {
      setQuery('');
    }
    setIsSearchFocused(false);
    const input = searchRef.current?.querySelector('input:not([type="hidden"])') as HTMLInputElement | null;
    input?.blur();
  }, [clearAddedFeedback, effectiveQuery]);

  const applyDraftFilters = useCallback(() => {
    setSelectedBrand(draftFilters.brand);
    setSelectedGroup(draftFilters.group);
    setSortMode(draftFilters.sort);
    setInStockOnly(draftFilters.inStockOnly);
    setIsBrandSheetOpen(false);
  }, [draftFilters]);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try {
      window.localStorage.removeItem(`${RECENT_SEARCHES_KEY}:${userName ?? 'guest'}`);
    } catch {
      // Ignore storage failures.
    }
  }, [userName]);

  const handlePopularFilterPick = useCallback((brand: string) => {
    setSelectedBrand(brand);
    setSelectedGroup(null);
    setIsSearchFocused(false);
  }, []);

  const handleStartAdd = (item: Item) => {
    if (recentlyAddedItemId === item.id) {
      clearAddedFeedback();
    }
    setPendingAddItemId(item.id);
  };

  const handleConfirmAdd = (item: Item, qty: number) => {
    addItem(item, qty);
    setPendingAddItemId(null);
    showAddedFeedback(item.id);
  };

  const handleCancelAdd = () => {
    setPendingAddItemId(null);
  };

  const handleConfirmSpecialRateAdd = (item: Item, qty: number) => {
    setPendingAddItemId(null);
    setRateItem(item);
    setRateQty(qty);
    setRateValue('');
  };

  const handleRateSave = () => {
    if (!rateItem) return;
    const n = parseFloat(rateValue.replace(/,/g, ''));
    if (isNaN(n) || n < 0) return;
    addItem(rateItem, rateQty, n);
    showAddedFeedback(rateItem.id);
    setRateItem(null);
    setRateValue('');
    focusSearchInput(60);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {!isSearchMode && <PageHeader title="New Order" />}

      <div className="px-4 pb-4">
        {/* Sticky search + filters */}
        <div
          ref={searchRef}
          className={`sticky z-30 -mx-4 px-4 ${isSearchMode ? 'top-0 pt-2' : 'top-11 pt-1.5'} pb-2 space-y-1.5 bg-[var(--bg-primary)] border-b border-[var(--border-subtle)]`}
        >
          <div className="flex items-center gap-2">
            {isSearchMode && (
              <button
                type="button"
                onClick={handleBackFromSearch}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-secondary)] shadow-sm"
                aria-label="Exit search"
              >
                <CaretLeft size={22} weight="bold" />
              </button>
            )}
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
              onClick={() => navigate('/sales/cart')}
              className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full border shadow-sm transition-all ${
                cartPulse
                  ? 'scale-[1.04] border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-secondary)]'
              }`}
              aria-label={totalCount > 0 ? `Open cart with ${totalCount} items` : 'Open cart'}
            >
              <ShoppingCart size={20} weight={totalCount > 0 ? 'fill' : 'regular'} />
              {totalCount > 0 && (
                <span className="type-micro absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#d92d20] px-1 text-white">
                  {totalCount}
                </span>
              )}
            </button>
          </div>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setIsBrandSheetOpen(true)}
              className={`relative flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full border px-3 shadow-sm transition-colors ${
                activeFilterCount > 0
                  ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-secondary)]'
              }`}
              aria-label={activeFilterCount > 0 ? `Open filters. ${activeFilterCount} active.` : 'Open filters'}
            >
              <FunnelSimple size={18} weight="bold" />
              {activeFilterCount > 0 && (
                <span className="type-micro absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--bg-accent)] px-1 text-[var(--content-on-color)]">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <FilterChip label="All" selected={activeFilterCount === 0} onClick={clearAllFilters} />
            {selectedBrand && (
              <FilterChip
                label={formatBrandLabel(selectedBrand)}
                selected
                removable
                onClick={() => setIsBrandSheetOpen(true)}
                onRemove={() => {
                  setSelectedBrand(null);
                  setSelectedGroup(null);
                }}
              />
            )}
            {selectedGroup && (
              <FilterChip
                label={selectedGroup}
                selected
                removable
                onClick={() => setIsBrandSheetOpen(true)}
                onRemove={() => setSelectedGroup(null)}
              />
            )}
            {inStockOnly && (
              <FilterChip
                label="In stock"
                selected
                removable
                onClick={() => setIsBrandSheetOpen(true)}
                onRemove={() => setInStockOnly(false)}
              />
            )}
            {sortMode !== 'relevance' && (
              <FilterChip
                label={sortLabel}
                selected
                removable
                onClick={() => setIsBrandSheetOpen(true)}
                onRemove={() => setSortMode('relevance')}
              />
            )}
          </div>
          {activeFilterSummary && (
            <p className="type-body-sm px-1 text-[var(--content-tertiary)]">
              Showing results for <span className="font-medium text-[var(--content-primary)]">{activeFilterSummary}</span>
            </p>
          )}
        </div>

        {/* Results area */}
        <div
          className={`space-y-4 transition-opacity duration-100 ${totalCount > 0 ? 'pb-32' : ''} ${isStale ? 'opacity-60' : 'opacity-100'}`}
        >
          {itemsLoading ? (
            <Skeleton variant="list" count={1} lines={6} />
          ) : isSearchMode && !effectiveQuery && !selectedBrand ? (
            <SearchDiscoveryPanel
              recentSearches={recentSearches}
              popularSearches={popularQuickFilters}
              onSearchPick={handleQueryChange}
              onPopularFilterPick={handlePopularFilterPick}
              onClearHistory={clearRecentSearches}
            />
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
              <p className="type-body-strong text-[var(--content-primary)]">No results</p>
              <p className="type-body-sm text-[var(--content-tertiary)]">
                {selectedBrand
                  ? `No "${effectiveQuery}" in ${formatBrandLabel(selectedBrand)}`
                  : isCodeMode
                    ? 'Code not found — check the number and try again'
                  : 'Try a shorter name or use a part code'}
              </p>
              <div className="flex items-center justify-center gap-4">
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearAllFilters}
                    className="type-body-sm text-[var(--bg-accent)] underline"
                  >
                    Clear filters
                  </button>
                )}
                <button
                  onClick={() => setIsBrandSheetOpen(true)}
                  className="type-body-sm text-[var(--bg-accent)] underline"
                >
                  Open filters
                </button>
              </div>
            </div>
          ) : (
            <>
              <ResultSection
                label={sortMode === 'relevance' ? 'Best match' : 'Results'}
                results={bestMatches}
                query={effectiveQuery}
                onStartAdd={handleStartAdd}
                onConfirmAdd={handleConfirmAdd}
                onConfirmSpecialRateAdd={handleConfirmSpecialRateAdd}
                onCancelAdd={handleCancelAdd}
                pendingAddItemId={pendingAddItemId}
                getTotalInOrderQty={getTotalInOrderQty}
                getPrice={getPrice}
                hasSpecialLine={hasSpecialLine}
                isJustAdded={isJustAdded}
              />
              <ResultSection
                label={bestMatches.length ? 'More results' : 'Results'}
                results={moreDisplayed}
                query={effectiveQuery}
                onStartAdd={handleStartAdd}
                onConfirmAdd={handleConfirmAdd}
                onConfirmSpecialRateAdd={handleConfirmSpecialRateAdd}
                onCancelAdd={handleCancelAdd}
                pendingAddItemId={pendingAddItemId}
                getTotalInOrderQty={getTotalInOrderQty}
                getPrice={getPrice}
                hasSpecialLine={hasSpecialLine}
                isJustAdded={isJustAdded}
              />
              {hasMoreResults && (
                <button
                  type="button"
                  onClick={() =>
                    setMoreVisible(v => Math.min(v + MORE_RESULTS_PAGE, moreResults.length))
                  }
                  className="type-body-sm-strong w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] py-3 text-[var(--bg-accent)] hover:bg-[var(--bg-tertiary)] active:scale-[0.99]"
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
            <p className="type-body-strong text-[var(--content-primary)]">
              {cartItems.length} item{cartItems.length !== 1 ? 's' : ''} · {totalCount} pcs
            </p>
            <p className="type-heading-m font-mono font-bold text-[var(--content-primary)]">
              {formatCurrency(totalValue)}
            </p>
          </div>
          <button
            onClick={() => navigate('/sales/cart')}
            className="type-label flex min-h-12 items-center gap-1.5 rounded-xl bg-[var(--bg-accent)] px-4 text-[var(--content-on-color)] hover:opacity-90 active:scale-95"
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
            <p className="type-body-sm text-[var(--content-tertiary)]">
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
                className="type-label flex h-12 flex-1 items-center justify-center rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-secondary)] hover:opacity-90"
              >
                Cancel
              </button>
              <button
                onClick={handleRateSave}
                className="type-label flex h-12 flex-1 items-center justify-center rounded-xl bg-[var(--bg-accent)] text-[var(--content-on-color)] hover:opacity-90 active:scale-95"
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
        titleAlign="center"
        headerAction={
          draftFilterCount > 0 ? (
            <button
              type="button"
              onClick={() =>
                setDraftFilters({
                  brand: null,
                  group: null,
                  sort: 'relevance',
                  inStockOnly: false,
                })
              }
              className="type-body-sm rounded-full bg-[var(--bg-tertiary)] px-3 py-2 font-medium text-[var(--bg-accent)]"
            >
              Reset
            </button>
          ) : undefined
        }
        footer={
          <button
            type="button"
            onClick={applyDraftFilters}
            className="type-label flex h-12 w-full items-center justify-center rounded-full bg-[var(--bg-accent)] text-[var(--content-on-color)] shadow-lg hover:opacity-95 active:scale-[0.99]"
          >
            Apply {draftFilterCount > 0 ? `(${draftFilterCount})` : ''}
          </button>
        }
      >
        <SearchFilterSheetContent
          brands={brandOptions}
          groups={draftSubGroupsForBrand}
          draft={draftFilters}
          onDraftChange={setDraftFilters}
        />
      </BottomSheet>
    </div>
  );
}
