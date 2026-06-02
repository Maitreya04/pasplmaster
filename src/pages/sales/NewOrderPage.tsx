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
  type ReactNode,
} from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Plus,
  ShoppingCart,
  CaretRight,
  Check,
  FunnelSimple,
  Trash,
  CurrencyInr,
  MagnifyingGlass,
  CaretLeft,
  Gift,
} from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useItems } from '../../hooks/useItems';
import {
  getStockQtyForLocation,
  stockLocationLabel,
  isLocationwiseStockResolving,
  useLocationwiseStock,
} from '../../hooks/useLocationwiseStock';
import { useBillingVerifiedLabelMrpMap } from '../../hooks/useBillingVerifiedLabelMrpMap';
import {
  cartSpecialRateForVerified,
  defaultSalesRateForItem,
} from '../../lib/billing/billingVerifiedMrp';
import { useUserStockLocation } from '../../hooks/useUserStockLocation';
import { useCart } from '../../context/CartContext';
import { appHaptics } from '../../lib/haptics';
import { useOrderAuthor } from '../../context/OrderAuthorContext';
import { useIsBillingOnBehalfOrderFlow, useOrderRoutes } from '../../context/OrderRoutesContext';
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
import { buildNarrowIndex } from '../../lib/search/narrowSuggestions';
import { buildSearchIndex } from '../../lib/search/searchIndex';
import { formatCurrency, formatShortDate } from '../../utils/formatters';
import { supabase } from '../../lib/supabase/client';
import {
  buildCustomerDuplicateNameSet,
  getCustomerSearchText,
  getCustomerSecondaryLine,
  getCustomerTertiaryLine,
  normalizeCustomerText,
} from '../../lib/customerDisplay';
import {
  PageHeader,
  SearchInput,
  BottomSheet,
  Skeleton,
  NumberStepper,
} from '../../components/shared';
import { useSalesChrome } from './SalesChromeContext';
import type { Item, Customer, StockLocationCode } from '../../types';
import {
  formatStockQty,
  getStockTier,
  stockAfterOrderLine,
  type StockTier,
} from '../../lib/stockDisplay';
import { KeyboardAccessoryBar } from '../../components/sales/KeyboardAccessoryBar';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import {
  ITEM_CARD_STATE,
  useItemCardState,
  type ConfirmedCardSnapshot,
  type ItemCardState,
} from '../../hooks/useItemCardState';
import {
  allSalesUnitsOos,
  autoSelectUnitId,
  cartLineEaPieces,
  doneBadgeText,
  IMPLICIT_SALES_UNIT_ID,
  qtyToEa,
  stockQtyInSalesUnit,
  unitLabel,
} from '../../lib/sales/sellingUnits';

/** First paint of "More results" before expanding; search still returns up to MAX_RESULTS. */

interface BrandOption {
  name: string;
  count: number;
}

interface TopCustomer {
  customer_name: string;
  order_count: number;
  last_order_date: string | null;
}

/** Rows from get_customer_quick_reorder_stats (live orders + order_lines). */
interface CustomerQuickReorderRow {
  item_id: number;
  order_count: number;
  most_common_qty: number | null;
  last_ordered: string | null;
}

interface TrendingRow {
  item_id: number;
  order_count: number;
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

const EMPTY_CUSTOMER_QUICK_REORDER: CustomerQuickReorderRow[] = [];
const EMPTY_TOP_CUSTOMERS: TopCustomer[] = [];
const EMPTY_TRENDING: TrendingRow[] = [];

interface SmartLandingProps {
  items: Item[];
  onCustomerSelect: (customer: Customer | null) => void;
  onQuickReorderApply: (customer: Customer | null, entries: { item: Item; qty: number }[]) => void;
  scrollToSearch: () => void;
}

type CustomerSheetMode = 'search' | 'create';

const TrendingAddControl = memo(function TrendingAddControl({
  item,
  onApply,
}: {
  item: Item;
  onApply: (entries: { item: Item; qty: number }[]) => void;
}) {
  const [draftQty, setDraftQty] = useState(1);
  const [isEditing, setIsEditing] = useState(false);

  const handleStart = useCallback(() => {
    appHaptics.impactLight();
    setDraftQty(1);
    setIsEditing(true);
  }, []);

  const handleCancel = useCallback(() => {
    appHaptics.warning();
    setDraftQty(1);
    setIsEditing(false);
  }, []);

  const handleApply = useCallback(() => {
    onApply([{ item, qty: draftQty }]);
    setDraftQty(1);
    setIsEditing(false);
  }, [draftQty, item, onApply]);

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={handleStart}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--bg-accent)] text-[var(--content-on-color)] shadow-sm transition-all duration-200 hover:opacity-95 active:scale-95"
        aria-label={`Add ${item.name}`}
      >
        <Plus size={20} weight="bold" />
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div onClick={(event) => event.stopPropagation()}>
        <NumberStepper
          value={draftQty}
          min={1}
          presets={[]}
          variant="compact"
          showRemoveAtMin
          onRemove={handleCancel}
          onChange={setDraftQty}
        />
      </div>
      <button
        type="button"
        onClick={handleApply}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--bg-accent)] text-[var(--content-on-color)] shadow-sm transition-all duration-200 hover:opacity-95 active:scale-95"
        aria-label={`Add ${draftQty} of ${item.name}`}
      >
        <Check size={18} weight="bold" />
      </button>
    </div>
  );
});

function SmartLanding({ items, onCustomerSelect, onQuickReorderApply, scrollToSearch }: SmartLandingProps) {
  const { userName } = useOrderAuthor();
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
    staleTime: 60 * 1000,
    queryFn: async () => {
      if (!userName) return [];
      const { data, error } = await supabase.rpc('get_salesperson_top_customers_live', {
        p_salesperson_name: userName,
        p_limit: 8,
      });
      if (error) throw error;
      return (data ?? []) as TopCustomer[];
    },
  });

  const { data: trendingRaw = EMPTY_TRENDING } = useQuery<TrendingRow[]>({
    queryKey: ['trending_items'],
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_trending_items_live', { p_limit: 5 });
      if (error) throw error;
      return (data ?? []) as TrendingRow[];
    },
  });

  const [activeCustomerId, setActiveCustomerId] = useState<number | null>(null);
  const [quickReorderItems, setQuickReorderItems] = useState<
    { item: Item; suggestedQty: number; checked: boolean; orderCount: number; mostCommonQty: number | null }[]
  >([]);
  const duplicateCustomerNames = useMemo(() => buildCustomerDuplicateNameSet(customers), [customers]);

  const idToItem = useMemo(() => {
    const map = new Map<number, Item>();
    for (const it of items) {
      map.set(it.id, it);
    }
    return map;
  }, [items]);

  const activeCustomer = activeCustomerId != null
    ? customers.find((customer) => customer.id === activeCustomerId) ?? null
    : null;
  const activeCustomerName = activeCustomer?.name ?? null;

  const {
    data: quickReorderStats = EMPTY_CUSTOMER_QUICK_REORDER,
    isLoading: quickReorderLoading,
  } = useQuery<CustomerQuickReorderRow[]>({
    queryKey: ['customer_quick_reorder', activeCustomer?.id],
    enabled: !!activeCustomer?.id,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const customerId = activeCustomer?.id;
      if (customerId == null) return [];

      const { data, error } = await supabase.rpc('get_customer_quick_reorder_stats', {
        p_customer_id: customerId,
        p_limit: 15,
      });
      if (error) throw error;
      return (data ?? []) as CustomerQuickReorderRow[];
    },
  });

  // Build quick reorder items when selection or source data changes
  useEffect(() => {
    if (!quickReorderStats?.length) {
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
    for (const row of quickReorderStats) {
      const item = idToItem.get(Number(row.item_id));
      if (!item) continue;
      const suggested =
        row.most_common_qty && row.most_common_qty > 0 ? Math.round(Number(row.most_common_qty)) : 1;
      rows.push({
        item,
        suggestedQty: suggested,
        checked: false,
        orderCount: row.order_count ?? 0,
        mostCommonQty: row.most_common_qty,
      });
    }
    setQuickReorderItems(rows);
  }, [quickReorderStats, idToItem]);

  const hasSmartData = !!userName && !topCustomersLoading;

  const trendingItems = useMemo(() => {
    if (!trendingRaw.length) return [];
    const out: { item: Item; totalOrderCount: number }[] = [];
    for (const row of trendingRaw) {
      const item = idToItem.get(Number(row.item_id));
      if (!item) continue;
      out.push({ item, totalOrderCount: row.order_count ?? 0 });
    }
    return out;
  }, [trendingRaw, idToItem]);

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
        const address = customer.address?.toLowerCase() ?? '';
        const searchText = getCustomerSearchText(customer);
        let score = Number.POSITIVE_INFINITY;
        if (name === q) score = 0;
        else if (name.startsWith(q)) score = 1;
        else if (name.split(/\s+/).some((part) => part.startsWith(q))) score = 2;
        else if (address.startsWith(q)) score = 3;
        else if (city.startsWith(q)) score = 4;
        else if (name.includes(q)) score = 5;
        else if (address.includes(q) || city.includes(q)) score = 6;
        else if (searchText.includes(q)) score = 7;
        return { customer, score };
      })
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => a.score - b.score || a.customer.name.localeCompare(b.customer.name))
      .slice(0, 20)
      .map((entry) => entry.customer);
  }, [customerQuery, customers]);

  const selectCustomer = useCallback((customer: Customer | null) => {
    setActiveCustomerId(customer?.id ?? null);
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
    // Logged-out or still loading top-customer summary
    return (
      <div className="space-y-6 pt-4">
        {trendingItems.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Trending
            </h3>
            <p className="text-xs text-[var(--content-quaternary)]">From orders placed in the app</p>
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
                      In {totalOrderCount} order{totalOrderCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <TrendingAddControl
                    item={item}
                    onApply={(entries) => onQuickReorderApply(null, entries)}
                  />
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
            const matchingCustomers = customers.filter((customer) => customer.name === c.customer_name);
            const hasDuplicateName = matchingCustomers.length > 1;
            const isActive = matchingCustomers.some((customer) => customer.id === activeCustomerId);
            return (
              <button
                key={`${c.customer_name}-${c.last_order_date ?? 'none'}`}
                type="button"
                onClick={() => {
                  if (matchingCustomers.length === 1) {
                    selectCustomer(matchingCustomers[0]);
                    return;
                  }
                  setCustomerQuery(c.customer_name);
                  setCustomerSheetOpen(true);
                  setCustomerSheetMode('search');
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
                    : hasDuplicateName
                      ? 'Choose branch'
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
        sheetClassName="h-[62vh] max-h-[62vh]"
        contentClassName={customerSheetMode === 'search' ? '!px-0 !pb-0' : ''}
        keyboardBehavior="static"
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
                  placeholder="Search by customer, city, or address…"
                  className="w-full min-h-14 rounded-2xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] pl-10 pr-4 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
              <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="font-ds-label-size font-semibold uppercase tracking-[0.08em] text-[var(--content-tertiary)]">
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
                      activeCustomerId === customer.id
                        ? 'border-[color-mix(in_srgb,var(--bg-accent)_34%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--bg-accent)_8%,white)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-ds-lead font-semibold text-[var(--content-primary)]">
                          {customer.name}
                        </p>
                        {(getCustomerSecondaryLine(customer, duplicateCustomerNames) || getCustomerTertiaryLine(customer, duplicateCustomerNames)) && (
                          <p className="mt-1 line-clamp-1 text-sm text-[var(--content-tertiary)]">
                            {getCustomerSecondaryLine(customer, duplicateCustomerNames) && (
                              <span className="font-medium text-[var(--content-secondary)]">
                                {getCustomerSecondaryLine(customer, duplicateCustomerNames)}
                              </span>
                            )}
                            {getCustomerSecondaryLine(customer, duplicateCustomerNames) && getCustomerTertiaryLine(customer, duplicateCustomerNames) && (
                              <span className="px-1 text-[var(--content-quaternary)]">·</span>
                            )}
                            {getCustomerTertiaryLine(customer, duplicateCustomerNames) && (
                              <span>{getCustomerTertiaryLine(customer, duplicateCustomerNames)}</span>
                            )}
                          </p>
                        )}
                      </div>
                      {activeCustomerId === customer.id && (
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
                From orders placed in the app
              </p>
            )}
          </div>

          {quickReorderLoading && (
            <p className="text-xs text-[var(--content-tertiary)]">Loading suggestions…</p>
          )}

          {!quickReorderLoading && quickReorderItems.length === 0 && (
            <p className="text-xs text-[var(--content-tertiary)]">
              No order history in the app for this customer yet. Use search above to add items.
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
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Trending
            </h3>
            <p className="text-xs text-[var(--content-quaternary)]">From orders in the app</p>
          </div>
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
                    In {totalOrderCount} order{totalOrderCount === 1 ? '' : 's'}
                  </p>
                </div>
                <TrendingAddControl
                  item={item}
                  onApply={(entries) => onQuickReorderApply(null, entries)}
                />
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
  onConfirmAdd: (item: Item, qty: number, focQty: number, unitId: string) => void;
  onConfirmSpecialRateAdd: (item: Item, qty: number) => void;
  onCancelAdd: () => void;
  activeItemId: number | null;
  selectedUnit: string | null;
  onSelectUnit: (unitId: string) => void;
  cardState: ItemCardState;
  confirmedSnapshot?: ConfirmedCardSnapshot;
  onDoneBadgeTap: (item: Item) => void;
  onDraftQtyChange?: (qty: number) => void;
  totalInOrderQty: number;
  paidQtyInCart: number;
  focQtyInCart: number;
  price: number;
  sellableStockQty?: number | null;
  sellableLocationCode: StockLocationCode;
  stockResolving: boolean;
  mainStoreStockQty?: number | null;
  jabalpurStockQty?: number | null;
  hasSpecialLine: boolean;
  justAdded: boolean;
}

/** Same block size as `AliasCode` (px-3 py-1.5, 12px semibold) so SKU + special rate read as one chip row. */
function SpecialRateChip() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--bg-accent-subtle)] px-3 py-1.5 font-ds-caption-size font-semibold leading-none text-[var(--content-accent)]">
      Special rate
    </span>
  );
}

function UnitPillDisplay({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#E6F1FB] px-[9px] py-[3px] text-[11px] font-medium text-[#185FA5]">
      <Check size={12} weight="bold" aria-hidden />
      {label}
    </span>
  );
}

function DoneBadge({
  text,
  onTap,
}: {
  text: string;
  onTap: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
      className="inline-flex items-center gap-1 rounded-full bg-[#E1F5EE] px-[9px] py-[3px] text-[11px] font-medium text-[#085041]"
    >
      <Check size={12} weight="bold" aria-hidden />
      {text}
    </button>
  );
}

function FocChip({ qty }: { qty: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-3 py-1.5 font-ds-caption-size font-semibold leading-none text-[var(--content-positive)]">
      <Gift size={11} weight="fill" aria-hidden />
      FOC ×{qty}
    </span>
  );
}

/** Billable qty already in cart — compact ×N format, soft blue tint. */
function CartPaidQtyChip({ qty }: { qty: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-[color-mix(in_srgb,var(--bg-accent)_45%,var(--border-subtle))] bg-[var(--bg-accent-subtle)] px-3 py-1.5 font-mono font-ds-caption-size font-semibold tracking-[0.04em] text-[var(--content-accent)]"
      aria-label={`×${qty} in cart (billable qty)`}
    >
      ×{qty}
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
      className={`inline-flex max-w-full items-center rounded-full px-3 py-1.5 font-mono font-ds-caption-size font-semibold tracking-[0.04em] shrink-0 truncate ${
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

function LocationStockLine({
  label,
  stockQty,
  suffix,
}: {
  label: string;
  stockQty: number | null | undefined;
  suffix?: string;
}) {
  if (stockQty == null || !Number.isFinite(Number(stockQty))) return null;

  const tier = getStockTier(stockQty);
  const dotClass =
    tier === 'ok'
      ? 'bg-[var(--content-signal-ok)]'
      : tier === 'low'
        ? 'bg-[var(--content-signal-low)]'
        : tier === 'out'
          ? 'bg-[var(--bg-negative)]'
          : 'bg-[var(--content-quaternary)]';
  const textClass =
    tier === 'ok'
      ? 'text-content-signal-ok'
      : tier === 'low'
        ? 'text-content-signal-low'
        : tier === 'out'
          ? 'text-content-signal-out'
          : 'text-[var(--content-tertiary)]';

  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 font-ds-caption-size leading-snug">
      {/* dot + primary text stay together as a non-breaking unit */}
      <span className="inline-flex shrink-0 items-center gap-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
        <span className={`font-semibold ${textClass}`}>{formatStockQty(Number(stockQty))} in {label}</span>
      </span>
      {suffix && (
        <span className="font-medium text-[var(--content-tertiary)]">· {suffix}</span>
      )}
    </p>
  );
}

/** Single-line stock while editing qty: avoids duplicating “X in stock” + a separate red warning. */
function PendingItemStockLine({
  stockQty,
  totalInOrderQty,
  draftQty,
  sellableLocationCode,
  stockResolving,
  mainStoreStockQty,
  jabalpurStockQty,
}: {
  stockQty: number | null | undefined;
  totalInOrderQty: number;
  draftQty: number;
  sellableLocationCode: StockLocationCode;
  stockResolving: boolean;
  mainStoreStockQty?: number | null;
  jabalpurStockQty?: number | null;
}) {
  const tier = getStockTier(stockQty);

  if (stockResolving) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <LocationStockLine label="Main Store" stockQty={mainStoreStockQty} />
        <LocationStockLine label="Jabalpur" stockQty={jabalpurStockQty} />
        <p className="pl-3 font-ds-label-size font-medium leading-[1.35] text-[var(--content-secondary)]">
          Checking {stockLocationLabel(sellableLocationCode)} stock...
        </p>
      </div>
    );
  }

  if (tier === 'unknown' || stockQty == null || !Number.isFinite(Number(stockQty))) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <div
          className="rounded-lg border border-[color-mix(in_srgb,var(--border-warning)_40%,var(--border-subtle))] bg-[var(--bg-warning-subtle)] px-2 py-1.5"
          role="status"
        >
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-ds-caption-size font-semibold leading-snug">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--bg-warning)]" aria-hidden />
            <span className="min-w-0 text-[var(--content-warning)]">
              No {stockLocationLabel(sellableLocationCode)} stock available · {formatStockQty(draftQty)} in this add goes to PO
            </span>
          </p>
        </div>
        <LocationStockLine label="Main Store" stockQty={mainStoreStockQty} />
        <LocationStockLine label="Jabalpur" stockQty={jabalpurStockQty} />
      </div>
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
      <div className="flex min-w-0 flex-col gap-0.5">
        <div
          className="rounded-lg border border-[color-mix(in_srgb,var(--border-warning)_40%,var(--border-subtle))] bg-[var(--bg-warning-subtle)] px-2 py-1.5"
          role="status"
        >
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-ds-caption-size font-semibold leading-snug">
            {body}
          </p>
        </div>
        <LocationStockLine label="Main Store" stockQty={mainStoreStockQty} />
        <LocationStockLine label="Jabalpur" stockQty={jabalpurStockQty} />
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
            : 'min-w-0 text-[var(--content-secondary)]'
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
      <div className="flex min-w-0 flex-col gap-0.5">
        <div
          className="rounded-lg border border-[color-mix(in_srgb,var(--border-warning)_40%,var(--border-subtle))] bg-[var(--bg-warning-subtle)] px-2 py-1.5"
          role="status"
        >
          <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-ds-caption-size font-semibold leading-snug">
            {body}
          </p>
        </div>
        <LocationStockLine label="Main Store" stockQty={mainStoreStockQty} />
        <LocationStockLine label="Jabalpur" stockQty={jabalpurStockQty} />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <LocationStockLine label="Main Store" stockQty={mainStoreStockQty} />
      <LocationStockLine label="Jabalpur" stockQty={jabalpurStockQty} />
      <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 pt-0.5 font-ds-label-size font-medium leading-snug text-[var(--content-secondary)]">
        {body}
      </p>
    </div>
  );
}

function ItemStockBlock({
  stockQty,
  totalInOrderQty,
  sellableLocationCode,
  stockResolving,
  mainStoreStockQty,
  jabalpurStockQty,
}: {
  stockQty: number | null | undefined;
  totalInOrderQty: number;
  sellableLocationCode: StockLocationCode;
  stockResolving: boolean;
  mainStoreStockQty?: number | null;
  jabalpurStockQty?: number | null;
}) {
  const tier = getStockTier(stockQty);
  const secondary =
    tier !== 'unknown' && tier !== 'out' && stockQty != null && Number.isFinite(Number(stockQty))
      ? stockAfterOrderLine(Number(stockQty), totalInOrderQty, tier)
      : null;

  const inlineSuffix = secondary?.variant === 'line' ? secondary.text : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <LocationStockLine
        label="Main Store"
        stockQty={mainStoreStockQty}
        suffix={sellableLocationCode === 'main_store' ? inlineSuffix : undefined}
      />
      <LocationStockLine
        label="Jabalpur"
        stockQty={jabalpurStockQty}
        suffix={sellableLocationCode === 'jabalpur' ? inlineSuffix : undefined}
      />
      {stockResolving && (
        <p className="pl-3 font-ds-label-size font-medium leading-[1.35] text-[var(--content-secondary)]">
          Checking {stockLocationLabel(sellableLocationCode)} stock...
        </p>
      )}
      {!stockResolving && tier === 'unknown' && (
        <div className="mt-1 rounded-lg border border-[color-mix(in_srgb,var(--border-warning)_40%,var(--border-subtle))] bg-[var(--bg-warning-subtle)] px-2 py-1.5">
          <p className="font-ds-caption-size font-semibold leading-snug text-[var(--content-warning)]">
            No {stockLocationLabel(sellableLocationCode)} stock available · add goes to PO
          </p>
        </div>
      )}
      {secondary?.variant === 'shortfall' && (
        <div className="mt-1 rounded-lg border border-[color-mix(in_srgb,var(--border-warning)_40%,var(--border-subtle))] bg-[var(--bg-warning-subtle)] px-2 py-1.5">
          <p className="font-ds-caption-size font-semibold leading-snug text-[var(--content-warning)]">{secondary.text}</p>
        </div>
      )}
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
  sellableStockQty,
  sellableLocationCode,
  stockResolving,
  mainStoreStockQty,
  jabalpurStockQty,
  hasSpecialLine,
  selectedUnit,
  initialQty,
  onDraftQtyChange,
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
  sellableStockQty?: number | null;
  sellableLocationCode: StockLocationCode;
  stockResolving: boolean;
  mainStoreStockQty?: number | null;
  jabalpurStockQty?: number | null;
  hasSpecialLine: boolean;
  selectedUnit: string | null;
  initialQty?: number;
  onDraftQtyChange?: (qty: number) => void;
  onConfirmAdd: (item: Item, qty: number, focQty: number, unitId: string) => void;
  onConfirmSpecialRateAdd: (item: Item, qty: number) => void;
  onCancelAdd: () => void;
}) {
  const qtyInputRef = useRef<HTMLInputElement | null>(null);
  const [draftQtyInput, setDraftQtyInput] = useState(String(initialQty ?? 1));
  const [focPanelOpen, setFocPanelOpen] = useState(false);
  const [committedFocQty, setCommittedFocQty] = useState(0);
  const [panelFocDraft, setPanelFocDraft] = useState(1);

  const getDraftQty = useCallback(() => {
    const parsed = parseInt(draftQtyInput.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) return 1;
    return parsed;
  }, [draftQtyInput]);

  useEffect(() => {
    onDraftQtyChange?.(getDraftQty());
  }, [draftQtyInput, getDraftQty, onDraftQtyChange]);

  useLayoutEffect(() => {
    qtyInputRef.current?.focus();
    qtyInputRef.current?.select();
  }, [item.id]);

  useEffect(() => {
    setDraftQtyInput(String(initialQty ?? 1));
    setFocPanelOpen(false);
    setCommittedFocQty(0);
    setPanelFocDraft(1);
  }, [item.id, initialQty]);

  const handleConfirmQty = useCallback(() => {
    if (!selectedUnit) return;
    onConfirmAdd(item, getDraftQty(), committedFocQty, selectedUnit);
  }, [committedFocQty, getDraftQty, item, onConfirmAdd, selectedUnit]);

  const handleSpecialRate = useCallback(() => {
    onConfirmSpecialRateAdd(item, getDraftQty());
  }, [getDraftQty, item, onConfirmSpecialRateAdd]);

  const openFocPanel = useCallback(() => {
    appHaptics.impactLight();
    setPanelFocDraft(Math.max(1, committedFocQty || 1));
    setFocPanelOpen(true);
  }, [committedFocQty]);

  const confirmFocPanel = useCallback(() => {
    appHaptics.impactMedium();
    setCommittedFocQty(panelFocDraft);
    setFocPanelOpen(false);
  }, [panelFocDraft]);

  const cancelFocPanel = useCallback(() => {
    appHaptics.warning();
    setFocPanelOpen(false);
  }, []);

  const draftQty = getDraftQty();
  const piecesForStock =
    (selectedUnit
      ? qtyToEa(item, draftQty, selectedUnit) + (committedFocQty > 0 ? qtyToEa(item, committedFocQty, selectedUnit) : 0)
      : draftQty + committedFocQty);
  const canConfirm = selectedUnit !== null;
  const draftGoesToPo =
    !stockResolving &&
    (
      sellableStockQty == null ||
      !Number.isFinite(Number(sellableStockQty)) ||
      totalInOrderQty + piecesForStock > Number(sellableStockQty)
    );

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
            {committedFocQty > 0 && <FocChip qty={committedFocQty} />}
          </div>
          <p className="font-ds-body-size font-semibold leading-[1.35] text-[var(--content-primary)] line-clamp-2 break-words">
            {highlightText(item.name, query)}
          </p>
          {selectedUnit ? (
            <UnitPillDisplay label={unitLabel(item, selectedUnit)} />
          ) : null}
          <PendingItemStockLine
            stockQty={sellableStockQty}
            totalInOrderQty={totalInOrderQty}
            draftQty={piecesForStock}
            sellableLocationCode={sellableLocationCode}
            stockResolving={stockResolving}
            mainStoreStockQty={mainStoreStockQty}
            jabalpurStockQty={jabalpurStockQty}
          />
        </div>
        <p className="shrink-0 pt-0.5 text-right font-mono font-ds-caption-size font-medium leading-none text-[var(--content-tertiary)]">
          {formatCurrency(price)}
        </p>
      </div>

      <div className="mt-2.5 grid grid-rows-[1fr] opacity-100 translate-y-0 transition-[grid-template-rows,opacity,transform,margin-top,padding-top] duration-200 ease-out">
        <div className="overflow-hidden">
          <div className="border-t border-[var(--border-subtle)] pt-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSpecialRate();
                  }}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-0 font-ds-prose font-semibold text-[var(--content-accent)]"
                  aria-label={`${hasSpecialLine ? 'Edit' : 'Set'} special rate for ${item.name}`}
                >
                  <CurrencyInr size={14} weight="bold" />
                  {hasSpecialLine ? 'Edit rate' : 'Special rate'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openFocPanel();
                  }}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-0 font-ds-prose font-semibold text-[var(--content-positive)]"
                  aria-label={`${committedFocQty > 0 ? 'Edit' : 'Add'} free-of-charge qty for ${item.name}`}
                >
                  <Gift size={14} weight="bold" />
                  {committedFocQty > 0 ? `FOC ×${committedFocQty}` : 'Add FOC'}
                </button>
              </div>

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
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d]/g, '');
                    setDraftQtyInput(v);
                  }}
                  data-item-qty-input={item.id}
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
                  aria-label="Paid quantity"
                  className="h-11 w-14 rounded-[14px] border border-[var(--bg-accent)] bg-[var(--bg-secondary)] text-center font-mono text-lg font-semibold text-[var(--content-primary)] outline-none focus:ring-1 focus:ring-[var(--bg-accent)]"
                />

                <button
                  type="button"
                  disabled={!canConfirm}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleConfirmQty();
                  }}
                  className={`flex h-11 w-11 items-center justify-center rounded-[14px] text-[var(--content-on-color)] hover:opacity-90 ${
                    !canConfirm
                      ? 'bg-[var(--bg-tertiary)] text-[var(--content-quaternary)] cursor-default'
                      : draftGoesToPo
                        ? 'bg-[var(--bg-warning)]'
                        : 'bg-[var(--bg-accent)]'
                  }`}
                  aria-label={draftGoesToPo ? `Add ${item.name} to purchase order` : `Add ${item.name}`}
                >
                  <Check size={18} weight="bold" />
                </button>
              </div>
            </div>

            {focPanelOpen && (
              <div
                className="mt-3 rounded-xl border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-3 py-3"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--content-positive)]">
                    How many units are FOC?
                  </p>
                  <button
                    type="button"
                    onClick={cancelFocPanel}
                    className="shrink-0 text-xs font-semibold text-[var(--content-tertiary)] hover:text-[var(--content-secondary)]"
                  >
                    Cancel
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <NumberStepper
                    value={panelFocDraft}
                    min={1}
                    presets={[]}
                    variant="compact"
                    colorScheme="positive"
                    onChange={setPanelFocDraft}
                  />
                  <button
                    type="button"
                    onClick={confirmFocPanel}
                    className="rounded-xl bg-[var(--bg-positive)] px-4 py-2.5 text-sm font-semibold text-[var(--content-on-color)] shadow-sm hover:opacity-95 active:scale-[0.98]"
                  >
                    Add FOC
                  </button>
                </div>
              </div>
            )}

            {committedFocQty > 0 && !focPanelOpen && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-positive)] bg-[color-mix(in_srgb,var(--bg-positive-subtle)_88%,transparent)] px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--bg-positive)] px-2.5 py-0.5 font-ds-micro font-bold uppercase tracking-wide text-[var(--content-on-color)]">
                    FOC
                  </span>
                  <span className="min-w-0 truncate font-ds-caption-size font-semibold text-[var(--content-primary)]">
                    {item.name} ×{committedFocQty}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono font-ds-caption-size font-semibold text-[var(--content-positive)]">
                    {formatCurrency(0)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openFocPanel();
                    }}
                    className="text-xs font-semibold text-[var(--content-tertiary)] hover:text-[var(--content-secondary)]"
                  >
                    Edit
                  </button>
                </div>
              </div>
            )}
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
  activeItemId,
  selectedUnit,
  onSelectUnit: _onSelectUnit,
  cardState,
  confirmedSnapshot,
  onDoneBadgeTap,
  onDraftQtyChange,
  totalInOrderQty,
  paidQtyInCart,
  focQtyInCart,
  price,
  sellableStockQty,
  sellableLocationCode,
  stockResolving,
  mainStoreStockQty,
  jabalpurStockQty,
  hasSpecialLine,
  justAdded,
}: ItemRowProps) {
  const { item, matchedField } = result;
  const isActive = activeItemId === item.id;
  const confirmed = confirmedSnapshot;
  const productCode = (item.alias1 ?? item.alias ?? '').toString().trim();
  const productCodeValue = productCode || '—';
  const showQtyEditor = isActive;
  const sellableQty = sellableStockQty == null ? null : Number(sellableStockQty);
  const allOos = allSalesUnitsOos(sellableQty, item);
  const nextAddGoesToPo =
    !stockResolving &&
    (
      sellableQty == null ||
      !Number.isFinite(sellableQty) ||
      sellableQty <= totalInOrderQty
    );

  const borderClass =
    cardState === ITEM_CARD_STATE.CONFIRMED
      ? 'border-[#1D9E75] shadow-[0_0_0_1px_color-mix(in_srgb,#1D9E75_20%,transparent)]'
      : showQtyEditor
        ? 'border-[var(--bg-accent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--bg-accent)_12%,transparent)]'
        : nextAddGoesToPo
          ? 'border-[color-mix(in_srgb,var(--border-warning)_45%,var(--border-subtle))]'
          : 'border-[var(--border-subtle)]';

  return (
    <li
      className={`overflow-hidden rounded-2xl border bg-[var(--bg-secondary)] px-3 py-2.5 transition-[border-color,box-shadow] duration-200 ease-out cursor-pointer ${borderClass}`}
      onClick={() => {
        if (cardState === ITEM_CARD_STATE.CONFIRMED) {
          onDoneBadgeTap(item);
          return;
        }
        if (!isActive && !allOos) {
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
          sellableStockQty={sellableStockQty}
          sellableLocationCode={sellableLocationCode}
          stockResolving={stockResolving}
          mainStoreStockQty={mainStoreStockQty}
          jabalpurStockQty={jabalpurStockQty}
          hasSpecialLine={hasSpecialLine}
          selectedUnit={selectedUnit}
          initialQty={confirmed?.qty}
          onDraftQtyChange={onDraftQtyChange}
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
              {paidQtyInCart > 0 && <CartPaidQtyChip qty={paidQtyInCart} />}
              {hasSpecialLine && <SpecialRateChip />}
              {focQtyInCart > 0 && <FocChip qty={focQtyInCart} />}
            </div>

            <p className="font-ds-body-size font-semibold leading-[1.35] text-[var(--content-primary)] line-clamp-2 break-words">
              {highlightText(item.name, query)}
            </p>
            {confirmed ? (
              <DoneBadge
                text={doneBadgeText(confirmed.qty, item, confirmed.unitId)}
                onTap={() => onDoneBadgeTap(item)}
              />
            ) : null}

            <ItemStockBlock
              stockQty={sellableStockQty}
              totalInOrderQty={totalInOrderQty}
              sellableLocationCode={sellableLocationCode}
              stockResolving={stockResolving}
              mainStoreStockQty={mainStoreStockQty}
              jabalpurStockQty={jabalpurStockQty}
            />
          </div>

          <div className="flex shrink-0 flex-col items-end justify-center gap-2 self-stretch">
            <p className="text-right font-mono font-ds-caption-size font-medium leading-none text-[var(--content-tertiary)]">
              {formatCurrency(price)}
            </p>
            {!allOos ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartAdd(item);
                }}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm transition-all duration-200 active:scale-95 ${
                  nextAddGoesToPo
                    ? 'bg-[var(--bg-warning)] text-[var(--content-on-color)] hover:opacity-95'
                    : justAdded
                      ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] hover:opacity-95'
                      : 'bg-[var(--bg-accent)] text-[var(--content-on-color)] hover:opacity-95'
                }`}
                aria-label={nextAddGoesToPo ? 'Add to purchase order' : 'Add to cart'}
              >
                {justAdded ? <Check size={18} weight="bold" /> : <Plus size={20} weight="bold" />}
              </button>
            ) : (
              <span className="text-[10px] font-semibold text-[var(--content-negative)]">Out of stock</span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.result.item.id === nextProps.result.item.id &&
    prevProps.query === nextProps.query &&
    prevProps.activeItemId === nextProps.activeItemId &&
    prevProps.selectedUnit === nextProps.selectedUnit &&
    prevProps.totalInOrderQty === nextProps.totalInOrderQty &&
    prevProps.paidQtyInCart === nextProps.paidQtyInCart &&
    prevProps.focQtyInCart === nextProps.focQtyInCart &&
    prevProps.price === nextProps.price &&
    prevProps.sellableStockQty === nextProps.sellableStockQty &&
    prevProps.sellableLocationCode === nextProps.sellableLocationCode &&
    prevProps.stockResolving === nextProps.stockResolving &&
    prevProps.mainStoreStockQty === nextProps.mainStoreStockQty &&
    prevProps.jabalpurStockQty === nextProps.jabalpurStockQty &&
    prevProps.hasSpecialLine === nextProps.hasSpecialLine &&
    prevProps.justAdded === nextProps.justAdded &&
    prevProps.cardState === nextProps.cardState &&
    prevProps.confirmedSnapshot === nextProps.confirmedSnapshot
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
  activeItemId,
  selectedUnit,
  onSelectUnit,
  cardStateFor,
  confirmedByItemId,
  onDoneBadgeTap,
  onActiveDraftQtyChange,
  getTotalInOrderQty,
  getPaidQtyInCart,
  getFocQtyInCart,
  getPrice,
  getSellableStockQty,
  getStockResolving,
  sellableLocationCode,
  getMainStoreStockQty,
  getJabalpurStockQty,
  hasSpecialLine,
  isJustAdded,
}: {
  label: string;
  results: SearchResult[];
  query: string;
  onStartAdd: (item: Item) => void;
  onConfirmAdd: (item: Item, qty: number, focQty: number, unitId: string) => void;
  onConfirmSpecialRateAdd: (item: Item, qty: number) => void;
  onCancelAdd: () => void;
  activeItemId: number | null;
  selectedUnit: string | null;
  onSelectUnit: (unitId: string) => void;
  cardStateFor: (itemId: number) => ItemCardState;
  confirmedByItemId: Record<number, ConfirmedCardSnapshot>;
  onDoneBadgeTap: (item: Item) => void;
  onActiveDraftQtyChange: (qty: number) => void;
  getTotalInOrderQty: (id: number) => number;
  getPaidQtyInCart: (id: number) => number;
  getFocQtyInCart: (id: number) => number;
  getPrice: (item: Item) => number;
  getSellableStockQty: (item: Item) => number | null | undefined;
  getStockResolving: (item: Item) => boolean;
  sellableLocationCode: StockLocationCode;
  getMainStoreStockQty: (item: Item) => number | null | undefined;
  getJabalpurStockQty: (item: Item) => number | null | undefined;
  hasSpecialLine: (id: number) => boolean;
  isJustAdded: (id: number) => boolean;
}) {
  if (!results.length) return null;
  return (
    <div className="space-y-2">
      <p className="px-0.5 font-ds-label-size font-semibold uppercase tracking-[0.08em] text-[var(--content-tertiary)]">
        {label}
      </p>
      <ul className="space-y-2">
        {results.map(r => (
          <ItemRow
            key={r.item.id}
            result={r}
            query={query}
            activeItemId={activeItemId}
            selectedUnit={activeItemId === r.item.id ? selectedUnit : null}
            onSelectUnit={onSelectUnit}
            cardState={cardStateFor(r.item.id)}
            confirmedSnapshot={confirmedByItemId[r.item.id]}
            onDoneBadgeTap={onDoneBadgeTap}
            onDraftQtyChange={
              activeItemId === r.item.id ? onActiveDraftQtyChange : undefined
            }
            onConfirmAdd={onConfirmAdd}
            onConfirmSpecialRateAdd={onConfirmSpecialRateAdd}
            onCancelAdd={onCancelAdd}
            totalInOrderQty={getTotalInOrderQty(r.item.id)}
            paidQtyInCart={getPaidQtyInCart(r.item.id)}
            focQtyInCart={getFocQtyInCart(r.item.id)}
            price={getPrice(r.item)}
            sellableStockQty={getSellableStockQty(r.item)}
            sellableLocationCode={sellableLocationCode}
            stockResolving={getStockResolving(r.item)}
            mainStoreStockQty={getMainStoreStockQty(r.item)}
            jabalpurStockQty={getJabalpurStockQty(r.item)}
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
  const location = useLocation();
  const routes = useOrderRoutes();
  const isBillingOnBehalf = useIsBillingOnBehalfOrderFlow();
  const goToCart = useCallback(() => {
    appHaptics.impactMedium();
    navigate(routes.cart);
  }, [navigate, routes.cart]);
  const { data: items = [], isLoading: itemsLoading } = useItems();
  const { userId: orderAuthorUserId, userName: orderAuthorUserName } = useOrderAuthor();
  const {
    data: sellableLocationCode = 'main_store',
    isLoading: stockLocationLoading,
  } = useUserStockLocation(
    orderAuthorUserId,
    orderAuthorUserName,
  );
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
  const {
    activeItemId,
    selectedUnit,
    confirmedByItemId,
    cardStateFor,
    activate,
    selectUnit,
    resetActive,
    markConfirmed,
    reopenConfirmed,
  } = useItemCardState();
  const [rateSellingUnit, setRateSellingUnit] = useState(IMPLICIT_SALES_UNIT_ID);
  const [recentlyAddedItemId, setRecentlyAddedItemId] = useState<number | null>(null);
  const keyboardHeight = useKeyboardHeight();
  const [cartPulse, setCartPulse] = useState(false);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const focusGuardUntilRef = useRef(0);
  const touchScrollStartYRef = useRef<number | null>(null);
  const addedFeedbackTimeoutRef = useRef<number | null>(null);
  const cartPulseTimeoutRef = useRef<number | null>(null);

  const focusSearchInput = (delayMs = 0) => {
    focusGuardUntilRef.current = Date.now() + 900;
    window.setTimeout(() => {
      requestAnimationFrame(() => {
        searchInputRef.current?.focus({ preventScroll: true });
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
  const { setSuppressTopBarActions, setBottomNavHidden } = useSalesChrome();
  const activeFilterCount = (selectedBrand ? 1 : 0) + (selectedGroup ? 1 : 0);
  const activeFilterSummary = [selectedBrand, selectedGroup].filter(Boolean).join(' · ');
  const wantFocusFromLocation = (
    location.state as { focusSearch?: boolean } | null | undefined
  )?.focusSearch;

  useLayoutEffect(() => {
    if (!wantFocusFromLocation) return;

    const focusStateFrame = requestAnimationFrame(() => {
      setIsSearchFocused(true);
    });
    focusGuardUntilRef.current = Date.now() + 900;

    const focusNow = () => {
      searchInputRef.current?.focus({ preventScroll: true });
    };
    focusNow();
    const focusRetry = window.setTimeout(() => {
      requestAnimationFrame(focusNow);
    }, 80);
    const clearStateTimer = window.setTimeout(() => {
      navigate('.', { replace: true, state: {} });
    }, 320);

    return () => {
      cancelAnimationFrame(focusStateFrame);
      window.clearTimeout(focusRetry);
      window.clearTimeout(clearStateTimer);
    };
  }, [location.key, wantFocusFromLocation, navigate]);

  useEffect(() => {
    setSuppressTopBarActions(isSearchMode);
    return () => setSuppressTopBarActions(false);
  }, [isSearchMode, setSuppressTopBarActions]);

  useEffect(() => {
    setBottomNavHidden(keyboardHeight > 0);
    return () => setBottomNavHidden(false);
  }, [keyboardHeight, setBottomNavHidden]);

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
      if (Date.now() < focusGuardUntilRef.current) return;
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
    if (Date.now() < focusGuardUntilRef.current) return;
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

  const handleScrollCapture = useCallback(() => {
    dismissSearchKeyboard();
  }, [dismissSearchKeyboard]);

  const handleWheelCapture = useCallback(() => {
    dismissSearchKeyboard();
  }, [dismissSearchKeyboard]);

  // Build the search index ONCE from all items — brand/group filtering is done inside searchItems()
  const searchIndex = useMemo(() => buildSearchIndex(items), [items]);

  const searchResults = useMemo(() => {
    let results: SearchResult[] = [];
    if (deferredQuery) {
      results = searchItems(
        deferredQuery,
        searchIndex,
        selectedBrand,
        selectedGroup,
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
  }, [deferredQuery, searchIndex, selectedBrand, selectedGroup]);

  const visibleBusyCodes = useMemo(
    () => searchResults.map((result) => result.item.busy_code),
    [searchResults],
  );
  const {
    data: locationwiseStock = {},
    isFetching: locationwiseStockFetching,
  } = useLocationwiseStock(visibleBusyCodes);

  const { data: billingVerifiedMrpMap } = useBillingVerifiedLabelMrpMap(
    visibleBusyCodes,
    sellableLocationCode,
    !stockLocationLoading,
  );


  const cartQtyByItem = useMemo(() => {
    const totals = new Map<number, number>();
    for (const line of cartItems) {
      const pieces = cartLineEaPieces(line);
      totals.set(line.item.id, (totals.get(line.item.id) ?? 0) + pieces);
    }
    return totals;
  }, [cartItems]);

  const activeItem = useMemo(
    () => (activeItemId == null ? null : items.find((i) => i.id === activeItemId) ?? null),
    [activeItemId, items],
  );

  const activeResultIndex = useMemo(() => {
    if (activeItemId == null) return -1;
    return searchResults.findIndex((r) => r.item.id === activeItemId);
  }, [activeItemId, searchResults]);

  const handleNavPrev = useCallback(() => {
    if (activeResultIndex <= 0) return;
    for (let i = activeResultIndex - 1; i >= 0; i--) {
      const item = searchResults[i]!.item;
      if (cardStateFor(item.id) !== ITEM_CARD_STATE.CONFIRMED) {
        activate(item);
        return;
      }
    }
  }, [activeResultIndex, searchResults, cardStateFor, activate]);

  const handleNavNext = useCallback(() => {
    if (activeResultIndex < 0) return;
    for (let i = activeResultIndex + 1; i < searchResults.length; i++) {
      const item = searchResults[i]!.item;
      if (cardStateFor(item.id) !== ITEM_CARD_STATE.CONFIRMED) {
        activate(item);
        return;
      }
    }
  }, [activeResultIndex, searchResults, cardStateFor, activate]);

  const hasNavPrev = useMemo(() => {
    if (activeResultIndex <= 0) return false;
    return searchResults
      .slice(0, activeResultIndex)
      .some((r) => cardStateFor(r.item.id) !== ITEM_CARD_STATE.CONFIRMED);
  }, [activeResultIndex, searchResults, cardStateFor]);

  const hasNavNext = useMemo(() => {
    if (activeResultIndex < 0) return false;
    return searchResults
      .slice(activeResultIndex + 1)
      .some((r) => cardStateFor(r.item.id) !== ITEM_CARD_STATE.CONFIRMED);
  }, [activeResultIndex, searchResults, cardStateFor]);

  const focQtyByItem = useMemo(() => {
    const totals = new Map<number, number>();
    for (const line of cartItems) {
      const foc = Math.max(0, line.focQty ?? 0);
      if (foc <= 0) continue;
      totals.set(line.item.id, (totals.get(line.item.id) ?? 0) + foc);
    }
    return totals;
  }, [cartItems]);

  const paidQtyByItem = useMemo(() => {
    const totals = new Map<number, number>();
    for (const line of cartItems) {
      const paid = Math.max(0, line.qty);
      if (paid <= 0) continue;
      totals.set(line.item.id, (totals.get(line.item.id) ?? 0) + paid);
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
  const getPaidQtyInCart = (id: number) => paidQtyByItem.get(id) ?? 0;
  const getFocQtyInCart = (id: number) => focQtyByItem.get(id) ?? 0;
  const getPrice = (item: Item) => defaultSalesRateForItem(item, billingVerifiedMrpMap);
  const getMainStoreStockQty = (item: Item) => {
    const busyCode = item.busy_code == null ? NaN : Number(item.busy_code);
    if (!Number.isFinite(busyCode)) return null;
    return locationwiseStock[busyCode]?.mainStoreStockQty ?? null;
  };
  const getJabalpurStockQty = (item: Item) => {
    const busyCode = item.busy_code == null ? NaN : Number(item.busy_code);
    if (!Number.isFinite(busyCode)) return null;
    return locationwiseStock[busyCode]?.jabalpurStockQty ?? null;
  };
  const getSellableStockQty = (item: Item) => {
    const busyCode = item.busy_code == null ? NaN : Number(item.busy_code);
    if (!Number.isFinite(busyCode)) return null;
    return getStockQtyForLocation(locationwiseStock[busyCode], sellableLocationCode);
  };
  const getStockResolving = (item: Item) => {
    const busyCode = item.busy_code == null ? NaN : Number(item.busy_code);
    return stockLocationLoading || isLocationwiseStockResolving(busyCode, locationwiseStockFetching);
  };
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
    // iOS can emit tiny viewport/scroll adjustments while a long query is being edited.
    // Keep the keyboard alive during active typing so the input doesn't blur mid-entry.
    focusGuardUntilRef.current = Date.now() + 450;
    if (value.trim()) {
      resetActive();
    }
    clearAddedFeedback();
    setQuery(value);
  };

  const handleStartAdd = (item: Item) => {
    appHaptics.impactLight();
    if (recentlyAddedItemId === item.id) {
      clearAddedFeedback();
    }
    activeDraftQtyRef.current = 1;
    activate(item);
  };

  const activeDraftQtyRef = useRef(1);

  const handleConfirmAdd = (item: Item, qty: number, focQty: number, unitId: string) => {
    if (!unitId) return;
    appHaptics.impactMedium();
    addItem(item, qty, cartSpecialRateForVerified(item, billingVerifiedMrpMap), focQty, unitId);
    markConfirmed(item.id, unitId, qty);
    showAddedFeedback(item.id);
    searchInputRef.current?.blur();
  };

  const handleAccessoryConfirm = useCallback(() => {
    if (!activeItem || !selectedUnit) return;
    const qty = Math.max(1, activeDraftQtyRef.current);
    handleConfirmAdd(activeItem, qty, 0, selectedUnit);
  }, [activeItem, selectedUnit, addItem, billingVerifiedMrpMap]);

  const handleCancelAdd = () => {
    resetActive();
  };

  const handleDoneBadgeTap = (item: Item) => {
    const qty = reopenConfirmed(item);
    activeDraftQtyRef.current = qty;
  };

  const handleSelectUnit = useCallback(
    (unitId: string) => {
      if (!activeItem) return;
      const sellable = getSellableStockQty(activeItem);
      const stock = stockQtyInSalesUnit(sellable, activeItem, unitId);
      if (stock === 0) return;
      selectUnit(unitId);
    },
    [activeItem, getSellableStockQty, selectUnit],
  );

  const handleConfirmSpecialRateAdd = (item: Item, qty: number) => {
    resetActive();
    setRateItem(item);
    setRateQty(qty);
    setRateSellingUnit(selectedUnit ?? autoSelectUnitId(item) ?? IMPLICIT_SALES_UNIT_ID);
    setRateValue('');
  };

  const handleRateSave = () => {
    if (!rateItem) return;
    const n = parseFloat(rateValue.replace(/,/g, ''));
    if (isNaN(n) || n < 0) return;
    appHaptics.impactMedium();
    addItem(rateItem, rateQty, n, 0, rateSellingUnit);
    showAddedFeedback(rateItem.id);
    setRateItem(null);
    setRateValue('');
    focusSearchInput(60);
  };

  const searchStickyTopClass = isSearchMode
    ? isBillingOnBehalf
      ? 'top-11 pt-2'
      : 'top-0 pt-2'
    : isBillingOnBehalf
      ? 'top-[5.5rem] pt-1.5'
      : 'top-11 pt-1.5';

  return (
    <div className="min-h-screen flex flex-col">
      {!isSearchMode && (
        <PageHeader
          title="New Order"
          stickyTopClassName={isBillingOnBehalf ? 'top-11' : undefined}
          action={
            totalCount > 0 ? (
              <button
                onClick={goToCart}
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
          className={`sticky z-30 -mx-4 px-4 ${searchStickyTopClass} pb-2 space-y-1.5 bg-[var(--bg-primary)] border-b border-[var(--border-subtle)]`}
        >
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SearchInput
                placeholder="Search parts, name or code…"
                value={query}
                onChange={handleQueryChange}
                onFocus={() => {
                  focusGuardUntilRef.current = Date.now() + 900;
                  setIsSearchFocused(true);
                }}
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
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-[var(--bg-accent)] text-[var(--content-on-color)] font-ds-label-size font-bold flex items-center justify-center">
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
          className={`space-y-4 transition-opacity duration-100 ${isStale ? 'opacity-60' : 'opacity-100'}`}
          style={{
            paddingBottom:
              keyboardHeight > 0
                ? keyboardHeight + 46 + (totalCount > 0 ? 80 : 16)
                : totalCount > 0
                  ? 128
                  : 16,
          }}
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
                  addItem(
                    entry.item,
                    entry.qty,
                    cartSpecialRateForVerified(entry.item, billingVerifiedMrpMap),
                    0,
                    autoSelectUnitId(entry.item) ?? IMPLICIT_SALES_UNIT_ID,
                  );
                }
                goToCart();
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
            <ResultSection
              label="Results"
              results={searchResults}
              query={effectiveQuery}
              onStartAdd={handleStartAdd}
              onConfirmAdd={handleConfirmAdd}
              onConfirmSpecialRateAdd={handleConfirmSpecialRateAdd}
              onCancelAdd={handleCancelAdd}
              activeItemId={activeItemId}
              selectedUnit={selectedUnit}
              onSelectUnit={handleSelectUnit}
              cardStateFor={cardStateFor}
              confirmedByItemId={confirmedByItemId}
              onDoneBadgeTap={handleDoneBadgeTap}
              onActiveDraftQtyChange={(q) => {
                activeDraftQtyRef.current = q;
              }}
              getTotalInOrderQty={getTotalInOrderQty}
              getPaidQtyInCart={getPaidQtyInCart}
              getFocQtyInCart={getFocQtyInCart}
              getPrice={getPrice}
              getSellableStockQty={getSellableStockQty}
              getStockResolving={getStockResolving}
              sellableLocationCode={sellableLocationCode}
              getMainStoreStockQty={getMainStoreStockQty}
              getJabalpurStockQty={getJabalpurStockQty}
              hasSpecialLine={hasSpecialLine}
              isJustAdded={isJustAdded}
            />
          )}
        </div>
      </div>

      <KeyboardAccessoryBar
        activeItem={activeItem}
        selectedUnit={selectedUnit}
        onSelectUnit={handleSelectUnit}
        onConfirm={handleAccessoryConfirm}
        onNavPrev={handleNavPrev}
        onNavNext={handleNavNext}
        hasPrev={hasNavPrev}
        hasNext={hasNavNext}
        sellableEa={activeItem ? getSellableStockQty(activeItem) : null}
      />

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
            onClick={goToCart}
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
              Qty: <span className="font-mono">{rateQty}</span> · Default: {formatCurrency(getPrice(rateItem))}
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
