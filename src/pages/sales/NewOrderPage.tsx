import { useState, useMemo, useDeferredValue, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Minus, ShoppingCart, CaretRight, CaretDown, CurrencyInr } from '@phosphor-icons/react';
import { useItems } from '../../hooks/useItems';
import { useCart } from '../../context/CartContext';
import { searchItems, normalizeQuery, detectCodeLike } from '../../lib/search/itemSearch';
import type { SearchResult, MatchedField } from '../../lib/search/itemSearch';
import {
  PageHeader,
  SearchInput,
  FilterChip,
  BottomSheet,
  Skeleton,
  EmptyState,
  InlineQtyEditor,
} from '../../components/shared';
import type { Item } from '../../types';

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

  const brandSuggestions: NarrowSuggestion[] = [...brandCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([value, count]) => ({
      type: 'brand' as const,
      value,
      label: `Brand: ${value}`,
      count,
    }));

  const groupSuggestions: NarrowSuggestion[] = [...groupCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([value, count]) => ({
      type: 'group' as const,
      value,
      label: `Group: ${value}`,
      count,
    }));

  // Keep this list intentionally small to avoid clutter
  return [...brandSuggestions, ...groupSuggestions].slice(0, 4);
}

function formatCurrency(n: number | null | undefined) {
  if (!n || n <= 0) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

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
    <li className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] min-h-[60px]">
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
  const { items: cartItems, addItem, updateQty, setSpecialRate, getCartItem, totalCount, totalValue } =
    useCart();

  const [query, setQuery] = useState('');
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [isBrandSheetOpen, setIsBrandSheetOpen] = useState(false);
  const [rateItem, setRateItem] = useState<Item | null>(null);
  const [rateValue, setRateValue] = useState('');
  const [editingItemId, setEditingItemId] = useState<number | null>(null);

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

      <div className="px-4 pb-4 flex flex-col flex-1">
        {/* Search input + code badge + ephemeral narrow-by overlay */}
        <div className="relative">
          <SearchInput
            placeholder="Search parts, name or code…"
            value={query}
            onChange={setQuery}
            loading={itemsLoading}
            autoFocus
          />
          {isCodeMode && (
            <span className="absolute right-12 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide bg-[var(--bg-accent)] text-[var(--content-on-color)] pointer-events-none">
              CODE
            </span>
          )}
          {narrowSuggestions.length > 0 && !selectedBrand && !selectedGroup && (
            <div className="absolute left-0 right-0 mt-2 z-20">
              <div className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] px-3 py-2.5 shadow-lg space-y-1.5">
                <p className="text-[10px] uppercase tracking-wide text-[var(--content-tertiary)]">
                  Narrow by
                </p>
                <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
                  {narrowSuggestions.map(s => (
                    <button
                      key={`${s.type}-${s.value}`}
                      onClick={() => {
                        if (s.type === 'brand') setSelectedBrand(s.value);
                        if (s.type === 'group') setSelectedGroup(s.value);
                      }}
                      className="px-3 py-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-[var(--content-secondary)] text-xs flex items-center gap-1.5 shrink-0 active:scale-95"
                    >
                      <span>{s.label}</span>
                      <span className="text-[10px] text-[var(--content-quaternary)]">
                        ({s.count})
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Filter bar */}
        <div className="flex gap-2 py-3">
          <button
            onClick={() => setIsBrandSheetOpen(true)}
            className={`
              inline-flex items-center gap-1.5
              px-3 py-1.5 rounded-lg text-sm font-medium
              transition-colors duration-150
              ${
                selectedBrand
                  ? 'bg-[var(--bg-inverse-primary)] text-[var(--content-inverse-primary)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)] hover:text-[var(--content-primary)]'
              }
            `}
          >
            <span>{selectedBrand ? `Brand: ${selectedBrand}` : 'Brand'}</span>
            <CaretDown size={14} weight="bold" />
          </button>
        </div>

        {(selectedBrand || selectedGroup) && (
          <div className="flex flex-wrap gap-2 mb-2">
            {selectedBrand && (
              <FilterChip
                label={`Brand: ${selectedBrand}`}
                selected
                removable
                onClick={() => setSelectedBrand(null)}
              />
            )}
            {selectedGroup && (
              <FilterChip
                label={`Group: ${selectedGroup}`}
                selected
                removable
                onClick={() => setSelectedGroup(null)}
              />
            )}
          </div>
        )}

        {/* Results area */}
        <div
          className={`flex-1 overflow-y-auto space-y-4 transition-opacity duration-100 ${totalCount > 0 ? 'pb-24' : ''}`}
          style={{ opacity: isStale ? 0.6 : 1 }}
        >
          {itemsLoading ? (
            <Skeleton variant="list" count={1} lines={6} />
          ) : !effectiveQuery && !selectedBrand ? (
            <EmptyState
              icon={ShoppingCart}
              title="Search for parts"
              description="Type a name, code, or pick a group above."
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
