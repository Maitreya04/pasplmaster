import {
  useState,
  useMemo,
  useDeferredValue,
  useRef,
  useEffect,
  useLayoutEffect,
  memo,
  useCallback,
  type TouchEvent as ReactTouchEvent,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ShoppingCart, CaretRight, Check, FunnelSimple, Trash, CurrencyInr, MagnifyingGlass, MapPin, Phone, CaretLeft } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useItems } from '../../hooks/useItems';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
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
  NumberStepper,
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

type CustomerSheetMode = 'search' | 'create';

function normalizeCustomerText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function SmartLanding({ items, onCustomerSelect, onQuickReorderApply, scrollToSearch }: SmartLandingProps) {
  const { userName } = useAuth();
  const { data: customers = [] } = useCustomers();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [customerSheetOpen, setCustomerSheetOpen] = useState(false);
  const [customerSheetMode, setCustomerSheetMode] = useState<CustomerSheetMode>('search');
  const [customerQuery, setCustomerQuery] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftCity, setDraftCity] = useState('');
  const [draftMobile, setDraftMobile] = useState('');
  const [draftGstin, setDraftGstin] = useState('');
  const [draftAddress, setDraftAddress] = useState('');

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

  const customerRail = useMemo(() => {
    if (!activeCustomerName) return topCustomers;
    const alreadyVisible = topCustomers.some((customer) => customer.customer_name === activeCustomerName);
    if (alreadyVisible) return topCustomers;

    return [
      {
        customer_name: activeCustomerName,
        order_count: 0,
        last_order_date: null,
      },
      ...topCustomers,
    ];
  }, [activeCustomerName, topCustomers]);

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

  const openCustomerSheet = useCallback((mode: CustomerSheetMode = 'search') => {
    setCustomerSheetOpen(true);
    setCustomerSheetMode(mode);
    if (mode === 'search') {
      setCustomerQuery('');
    } else {
      setDraftName(customerQuery.trim());
      setDraftCity('');
      setDraftMobile('');
    }
  }, [customerQuery]);

  const closeCustomerSheet = useCallback(() => {
    setCustomerSheetOpen(false);
    setCustomerSheetMode('search');
    setCustomerQuery('');
    setDraftName('');
    setDraftCity('');
    setDraftMobile('');
    setDraftGstin('');
    setDraftAddress('');
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 20);
    return customers
      .map((customer) => {
        const name = customer.name.toLowerCase();
        const city = customer.city?.toLowerCase() ?? '';
        let score = Number.POSITIVE_INFINITY;
        if (name === q) score = 0;
        else if (name.startsWith(q)) score = 1;
        else if (name.split(/\s+/).some((part) => part.startsWith(q))) score = 2;
        else if (city.startsWith(q)) score = 3;
        else if (name.includes(q)) score = 4;
        else if (city.includes(q)) score = 5;
        return { customer, score };
      })
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => a.score - b.score || a.customer.name.localeCompare(b.customer.name))
      .slice(0, 20)
      .map((entry) => entry.customer);
  }, [customerQuery, customers]);

  const selectCustomer = useCallback((customer: Customer | null) => {
    setActiveCustomerName(customer?.name ?? null);
    onCustomerSelect(customer);
  }, [onCustomerSelect]);

  const createCustomerMutation = useMutation({
    mutationFn: async () => {
      const name = draftName.trim().replace(/\s+/g, ' ');
      const city = draftCity.trim().replace(/\s+/g, ' ');
      const mobile = draftMobile.trim().replace(/\s+/g, ' ');
      const gstin = draftGstin.trim().replace(/\s+/g, ' ');
      const address = draftAddress.trim().replace(/\s+/g, ' ');

      if (!name) throw new Error('Enter a customer name.');

      const existingCustomer = customers.find(
        (customer) => normalizeCustomerText(customer.name) === normalizeCustomerText(name),
      );
      if (existingCustomer) return existingCustomer;

      const { data, error } = await supabase
        .from('customers')
        .insert({
          name,
          city: city || null,
          mobile: mobile || null,
          gstin: gstin || null,
          address: address || null,
          is_active: true,
        })
        .select('*')
        .single();

      if (error) throw error;
      return data as Customer;
    },
    onSuccess: (customer) => {
      queryClient.setQueryData<Customer[]>(['customers'], (prev = []) => {
        if (prev.some((entry) => entry.id === customer.id)) return prev;
        return [...prev, customer];
      });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['salesperson_top_customers', userName] });
      selectCustomer(customer);
      closeCustomerSheet();

      const reusedExisting = customers.some((entry) => entry.id === customer.id);
      if (reusedExisting) toast.info(`Selected ${customer.name}.`);
      else toast.success(`${customer.name} added.`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not add customer right now.');
    },
  });

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
        <div className="mt-1 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            Your Customers
          </h3>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1 pt-1 scrollbar-none">
          <button
            type="button"
            onClick={() => openCustomerSheet('search')}
            className="min-w-44 max-w-56 px-3 py-3 rounded-lg text-left flex flex-col justify-between bg-[var(--bg-secondary)] border border-[var(--border-subtle)]"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--content-accent)]">
              <Plus size={16} weight="bold" />
            </div>
            <div className="pt-6">
              <p className="font-semibold text-[var(--content-accent)] line-clamp-2 leading-snug">
                Select customer
              </p>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--content-tertiary)]">
                <span>Recent + new</span>
                <CaretRight size={16} className="shrink-0 text-[var(--content-quaternary)]" />
              </div>
            </div>
          </button>
          {customerRail.map((c) => {
            const isActive = c.customer_name === activeCustomerName;
            return (
              <button
                key={c.customer_name}
                type="button"
                onClick={() => {
                  const customer = nameToCustomer.get(c.customer_name) ?? null;
                  selectCustomer(customer);
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
                  {c.order_count > 0
                    ? `${c.order_count} order${c.order_count === 1 ? '' : 's'}`
                    : isActive
                      ? 'Selected customer'
                      : 'Customer'}
                </p>
                <p className="text-xs text-[var(--content-tertiary)] mt-1">
                  {c.last_order_date ? `Last order ${formatShortDate(c.last_order_date)}` : isActive ? 'Ready for reorder' : 'No recent orders'}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <BottomSheet
        isOpen={customerSheetOpen}
        onClose={closeCustomerSheet}
        sheetClassName={customerSheetMode === 'search' ? 'max-h-[62vh]' : ''}
        contentClassName={customerSheetMode === 'search' ? '!px-0 !pb-0' : ''}
      >
        {customerSheetMode === 'search' ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 space-y-4 px-5 pb-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={closeCustomerSheet}
                  className="inline-flex min-h-11 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 text-sm font-semibold text-[var(--content-primary)]"
                >
                  Cancel
                </button>
                <h2 className="text-lg font-semibold text-[var(--content-primary)]">Customers</h2>
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(customerQuery.trim());
                    setDraftCity('');
                    setDraftMobile('');
                    setDraftGstin('');
                    setDraftAddress('');
                    setCustomerSheetMode('create');
                  }}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-primary)]"
                  aria-label="Add customer"
                >
                  <Plus size={22} weight="regular" />
                </button>
              </div>

              <div className="relative">
                <MagnifyingGlass
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--content-tertiary)]"
                />
                <input
                  type="text"
                  value={customerQuery}
                  onChange={(event) => setCustomerQuery(event.target.value)}
                  placeholder="Search by customer name or city…"
                  className="w-full min-h-14 rounded-2xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] pl-10 pr-4 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--content-tertiary)]">
                  {customerQuery.trim() ? 'Matches' : 'Customers'}
                </p>
                {filteredCustomers.length > 0 && (
                  <p className="text-xs text-[var(--content-tertiary)]">{filteredCustomers.length} shown</p>
                )}
              </div>

              {filteredCustomers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border-opaque)] bg-[var(--bg-secondary)] p-5 text-center">
                  <p className="text-sm font-semibold text-[var(--content-primary)]">No customers found</p>
                  <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                    Create a new customer and continue ordering.
                  </p>
                </div>
              ) : (
                filteredCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onClick={() => {
                      selectCustomer(customer);
                      closeCustomerSheet();
                    }}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                      activeCustomerName === customer.name
                        ? 'border-[color-mix(in_srgb,var(--bg-accent)_34%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--bg-accent)_8%,white)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-semibold text-[var(--content-primary)]">
                          {customer.name}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--content-tertiary)]">
                          {customer.city && (
                            <span className="inline-flex items-center gap-1">
                              <MapPin size={14} />
                              {customer.city}
                            </span>
                          )}
                          {customer.mobile && (
                            <span className="inline-flex items-center gap-1">
                              <Phone size={14} />
                              {customer.mobile}
                            </span>
                          )}
                        </div>
                      </div>
                      {activeCustomerName === customer.name && (
                        <Check size={16} weight="bold" className="shrink-0 text-[var(--content-accent)]" />
                      )}
                    </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createCustomerMutation.mutate();
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setCustomerSheetMode('search')}
                className="inline-flex min-h-11 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 text-sm font-semibold text-[var(--content-primary)]"
              >
                <CaretLeft size={18} weight="bold" />
              </button>
              <h2 className="text-lg font-semibold text-[var(--content-primary)]">Add Customer</h2>
              <button
                type="submit"
                disabled={createCustomerMutation.isPending}
                className="inline-flex min-h-11 items-center rounded-full bg-[var(--bg-accent)] px-4 text-sm font-semibold text-[var(--content-on-color)] disabled:opacity-60"
              >
                {createCustomerMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--content-secondary)]">
                  Business name
                </label>
                <input
                  type="text"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  placeholder="Party name"
                  className="w-full min-h-14 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--content-secondary)]">
                  Location
                </label>
                <input
                  type="text"
                  value={draftCity}
                  onChange={(event) => setDraftCity(event.target.value)}
                  placeholder="Optional"
                  className="w-full min-h-14 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--content-secondary)]">
                  Phone
                </label>
                <input
                  type="tel"
                  value={draftMobile}
                  onChange={(event) => setDraftMobile(event.target.value)}
                  placeholder="Optional"
                  className="w-full min-h-14 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--content-secondary)]">
                  GST number
                </label>
                <input
                  type="text"
                  value={draftGstin}
                  onChange={(event) => setDraftGstin(event.target.value)}
                  placeholder="Optional"
                  className="w-full min-h-14 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--content-secondary)]">
                  Address
                </label>
                <textarea
                  value={draftAddress}
                  onChange={(event) => setDraftAddress(event.target.value)}
                  placeholder="Optional"
                  rows={3}
                  className="w-full resize-none rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                />
              </div>
            </div>
          </form>
        )}
      </BottomSheet>

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
    <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--bg-accent-subtle)] px-3 py-1.5 text-[12px] font-semibold leading-none text-[var(--content-accent)]">
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
      className={`inline-flex max-w-full items-center rounded-full px-3 py-1.5 font-mono text-[12px] font-semibold tracking-[0.04em] shrink-0 truncate ${
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
      <p className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold leading-snug">
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
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] font-semibold leading-snug">
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
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] font-semibold leading-snug">
          {body}
        </p>
      </div>
    );
  }

  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] font-semibold leading-snug">
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
      <p className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold leading-none">
        <StockStatusDot tier={tier} />
        <span className={`min-w-0 ${primaryTextClass}`}>{primary}</span>
      </p>
      {secondary &&
        (secondary.variant === 'shortfall' ? (
          <div className="mt-1 rounded-lg border border-[color-mix(in_srgb,var(--border-warning)_40%,var(--border-subtle))] bg-[var(--bg-warning-subtle)] px-2 py-1.5">
            <p className="text-[12px] font-semibold leading-snug text-[var(--content-warning)]">{secondary.text}</p>
          </div>
        ) : (
          <p
            className={`pl-3 text-[11px] font-medium leading-[1.35] ${
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
          <p className="text-[14px] font-semibold leading-[1.35] text-[var(--content-primary)] line-clamp-2 break-words">
            {highlightText(item.name, query)}
          </p>
          <PendingItemStockLine
            stockQty={item.stock_qty}
            totalInOrderQty={totalInOrderQty}
            draftQty={draftQty}
          />
        </div>
        <p className="shrink-0 pt-0.5 text-right font-mono text-[12px] font-medium leading-none text-[var(--content-tertiary)]">
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
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-0 text-[13px] font-semibold text-[var(--content-accent)]"
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
                  className="h-11 w-14 rounded-[14px] border border-[var(--bg-accent)] bg-[var(--bg-secondary)] text-center font-mono text-[18px] font-semibold text-[var(--content-primary)] outline-none focus:ring-1 focus:ring-[var(--bg-accent)]"
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

            <p className="text-[14px] font-semibold leading-[1.35] text-[var(--content-primary)] line-clamp-2 break-words">
              {highlightText(item.name, query)}
            </p>

            <ItemStockBlock stockQty={item.stock_qty} totalInOrderQty={totalInOrderQty} />

            {justAdded && (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-positive-subtle)] px-3 py-1.5 text-[12px] font-semibold leading-none text-[var(--content-positive)]">
                  <Check size={12} weight="bold" />
                  Added
                </span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end justify-center gap-2 self-stretch">
            <p className="text-right font-mono text-[12px] font-medium leading-none text-[var(--content-tertiary)]">
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
      <p className="px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--content-tertiary)]">
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
  const [isBrandSheetOpen, setIsBrandSheetOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [rateItem, setRateItem] = useState<Item | null>(null);
  const [rateQty, setRateQty] = useState(1);
  const [rateValue, setRateValue] = useState('');
  const [pendingAddItemId, setPendingAddItemId] = useState<number | null>(null);
  const [recentlyAddedItemId, setRecentlyAddedItemId] = useState<number | null>(null);
  const [cartPulse, setCartPulse] = useState(false);
  const [moreVisible, setMoreVisible] = useState(INITIAL_MORE_VISIBLE);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const touchScrollStartYRef = useRef<number | null>(null);
  const addedFeedbackTimeoutRef = useRef<number | null>(null);
  const cartPulseTimeoutRef = useRef<number | null>(null);

  const focusSearchInput = (delayMs = 0) => {
    window.setTimeout(() => {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
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
    const dismissSearchKeyboard = () => {
      if (document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur();
      }
    };

    document.addEventListener('scroll', dismissSearchKeyboard, { passive: true, capture: true });

    return () => {
      document.removeEventListener('scroll', dismissSearchKeyboard, true);
    };
  }, []);

  const dismissSearchKeyboard = useCallback(() => {
    if (document.activeElement === searchInputRef.current) {
      searchInputRef.current?.blur();
    }
  }, []);

  const handleScrollTouchStartCapture = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    touchScrollStartYRef.current = e.touches[0]?.clientY ?? null;
  }, []);

  const handleScrollTouchMoveCapture = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    const startY = touchScrollStartYRef.current;
    const currentY = e.touches[0]?.clientY;
    if (startY === null || currentY === undefined) return;
    if (Math.abs(currentY - startY) >= 6) {
      dismissSearchKeyboard();
      touchScrollStartYRef.current = currentY;
    }
  }, [dismissSearchKeyboard]);

  const handleScrollCapture = useCallback((_e: ReactUIEvent<HTMLDivElement>) => {
    dismissSearchKeyboard();
  }, [dismissSearchKeyboard]);

  const handleWheelCapture = useCallback((_e: ReactWheelEvent<HTMLDivElement>) => {
    dismissSearchKeyboard();
  }, [dismissSearchKeyboard]);

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
      {!isSearchMode && (
        <PageHeader
          title="New Order"
          action={
            totalCount > 0 ? (
              <button
                onClick={() => navigate('/sales/cart')}
                className={`relative flex items-center gap-1.5 min-h-12 min-w-12 px-2 rounded-lg transition-all ${
                  cartPulse
                    ? 'scale-[1.04] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                    : 'text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <ShoppingCart size={22} weight={totalCount > 0 ? 'fill' : 'regular'} />
                <span className="font-mono text-sm font-semibold">{totalCount}</span>
              </button>
            ) : null
          }
        />
      )}

      <div
        className="px-4 pb-4"
        onTouchStartCapture={handleScrollTouchStartCapture}
        onTouchMoveCapture={handleScrollTouchMoveCapture}
        onScrollCapture={handleScrollCapture}
        onWheelCapture={handleWheelCapture}
      >
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
                inputRef={searchInputRef}
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
