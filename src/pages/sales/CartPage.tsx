import { useState, useMemo, useRef, useCallback, useEffect, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MagnifyingGlass,
  CheckCircle,
  Plus,
  CurrencyInr,
  Trash,
  Copy,
  Check,
  CaretDown,
  CaretUp,
  ShoppingCart as ShoppingCartIcon,
} from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useOrderAuthor } from '../../context/OrderAuthorContext';
import { useOrderRoutes } from '../../context/OrderRoutesContext';
import { useCustomers } from '../../hooks/useCustomers';
import {
  sendInternalNotification,
  formatInternalNotificationError,
} from '../../lib/pickerPush';
import { ITEMS_QUERY_KEY } from '../../hooks/useItems';
import { broadcastItemsChanged, broadcastInvalidate } from '../../lib/crossTabSync';
import { useTransports } from '../../hooks/useTransports';
import {
  getStockQtyForLocation,
  stockLocationLabel,
  invalidateLocationwiseStockQueries,
  isLocationwiseStockResolving,
  normalizeBusyCodes,
  useLocationwiseStock,
} from '../../hooks/useLocationwiseStock';
import { useUserStockLocation } from '../../hooks/useUserStockLocation';
import { supabase } from '../../lib/supabase/client';
import {
  PageHeader,
  NumberStepper,
  BigButton,
  SelectTrigger,
  BottomSheet,
} from '../../components/shared';
import type { Customer, CartItem } from '../../types';

import { formatCurrencyRaw as formatCurrency } from '../../utils/formatters';
import { splitCartLinePaidFoc } from '../../lib/cartSupply';
import { appHaptics } from '../../lib/haptics';
import {
  buildOrderCustomerMessage,
  type OrderCustomerShareLine,
  whatsappPrefilledUrl,
} from '../../lib/buildOrderCustomerMessage';
import {
  buildCustomerDuplicateNameSet,
  getCustomerSearchText,
  getCustomerSecondaryLine,
  getCustomerTertiaryLine,
  normalizeCustomerText,
} from '../../lib/customerDisplay';

function submitSalesOrderErrorMessage(code: string | undefined, detail?: string): string {
  switch (code) {
    case 'no_lines':
      return 'Add at least one line item before submitting.';
    case 'invalid_customer':
      return 'Choose a customer before submitting.';
    case 'unknown_item':
      return 'An item in your cart was not found. Refresh the catalog and try again.';
    case 'submit_failed':
      return detail?.trim() || 'Order could not be submitted. Please try again.';
    default:
      return detail?.trim() || 'Order could not be submitted.';
  }
}

function reconcileLineToTotalPieces(
  ci: CartItem,
  newTotalPieces: number,
  actions: {
    updateQty: (lineId: string, qty: number) => void;
    updateFocQty: (lineId: string, focQty: number) => void;
    removeItem: (lineId: string) => void;
  },
): void {
  if (newTotalPieces < 1) {
    actions.removeItem(ci.lineId);
    return;
  }
  const foc = Math.max(0, ci.focQty ?? 0);
  const nextFoc = Math.min(foc, Math.max(0, newTotalPieces - 1));
  const nextPaid = newTotalPieces - nextFoc;
  if (nextPaid < 1) {
    actions.removeItem(ci.lineId);
    return;
  }
  actions.updateFocQty(ci.lineId, nextFoc);
  actions.updateQty(ci.lineId, nextPaid);
}

// ---------------------------------------------------------------------------
// SearchableCustomerDropdown
// ---------------------------------------------------------------------------
interface SearchableCustomerDropdownProps {
  value: Customer | null;
  onChange: (c: Customer | null) => void;
  placeholder?: string;
}

type CustomerSheetMode = 'search' | 'create';

function SearchableCustomerDropdown({
  value,
  onChange,
  placeholder = 'Select Customer',
}: SearchableCustomerDropdownProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CustomerSheetMode>('search');
  const [draftName, setDraftName] = useState('');
  const [draftCity, setDraftCity] = useState('');
  const [draftMobile, setDraftMobile] = useState('');
  const { data: customers = [], isLoading } = useCustomers();
  const queryClient = useQueryClient();
  const toast = useToast();
  const duplicateCustomerNames = useMemo(() => buildCustomerDuplicateNameSet(customers), [customers]);

  const openSheet = useCallback((nextMode: CustomerSheetMode = 'search') => {
    setOpen(true);
    setMode(nextMode);
    if (nextMode === 'search') {
      setQuery('');
    } else if (value) {
      setDraftName(value.name);
      setDraftCity(value.city ?? '');
      setDraftMobile(value.mobile ?? '');
    }
  }, [value]);

  const closeSheet = useCallback(() => {
    setOpen(false);
    setMode('search');
    setQuery('');
    setDraftName('');
    setDraftCity('');
    setDraftMobile('');
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers.slice(0, 30);
    return customers
      .map((c) => {
        const name = c.name.toLowerCase();
        const city = c.city?.toLowerCase() ?? '';
        const address = c.address?.toLowerCase() ?? '';
        const searchText = getCustomerSearchText(c);
        let score = Number.POSITIVE_INFINITY;
        if (name === q) score = 0;
        else if (name.startsWith(q)) score = 1;
        else if (name.split(/\s+/).some((part) => part.startsWith(q))) score = 2;
        else if (address.startsWith(q)) score = 3;
        else if (city.startsWith(q)) score = 4;
        else if (name.includes(q)) score = 5;
        else if (address.includes(q) || city.includes(q)) score = 6;
        else if (searchText.includes(q)) score = 7;
        return { customer: c, score };
      })
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => a.score - b.score || a.customer.name.localeCompare(b.customer.name))
      .slice(0, 30)
      .map((entry) => entry.customer);
  }, [customers, query]);

  const normalizedQuery = normalizeCustomerText(query);
  const hasExactMatch = useMemo(
    () => !!normalizedQuery && customers.some((c) => normalizeCustomerText(c.name) === normalizedQuery),
    [customers, normalizedQuery],
  );

  const createCustomerMutation = useMutation({
    mutationFn: async () => {
      const name = draftName.trim().replace(/\s+/g, ' ');
      const city = draftCity.trim().replace(/\s+/g, ' ');
      const mobile = draftMobile.trim().replace(/\s+/g, ' ');

      if (!name) {
        throw new Error('Enter a customer name.');
      }

      const existingCustomer = customers.find(
        (customer) => normalizeCustomerText(customer.name) === normalizeCustomerText(name),
      );
      if (existingCustomer) {
        return existingCustomer;
      }

      const { data, error } = await supabase
        .from('customers')
        .insert({
          name,
          city: city || null,
          mobile: mobile || null,
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
      onChange(customer);
      closeSheet();

      const reusedExisting = customers.some((entry) => entry.id === customer.id);
      if (reusedExisting) {
        toast.info(`Selected ${customer.name}.`);
      } else {
        toast.success(`${customer.name} added.`);
      }
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not add customer right now.';
      toast.error(message);
    },
  });

  const startCreateMode = useCallback((prefillName?: string) => {
    const nextName = prefillName?.trim() ?? query.trim() ?? '';
    setMode('create');
    setDraftName(nextName);
    setDraftCity('');
    setDraftMobile('');
  }, [query]);

  return (
    <div className="space-y-2.5">
      <SelectTrigger
        onClick={() => openSheet('search')}
        open={open}
        placeholder={placeholder}
        hasValue={!!value}
      >
        {value && (
          <>
            <span className="block truncate">{value.name}</span>
            {(getCustomerSecondaryLine(value, duplicateCustomerNames) || getCustomerTertiaryLine(value, duplicateCustomerNames)) && (
              <span className="mt-0.5 block truncate text-sm font-normal text-[var(--content-tertiary)]">
                {getCustomerSecondaryLine(value, duplicateCustomerNames) && (
                  <span className="font-medium text-[var(--content-secondary)]">
                    {getCustomerSecondaryLine(value, duplicateCustomerNames)}
                  </span>
                )}
                {getCustomerSecondaryLine(value, duplicateCustomerNames) && getCustomerTertiaryLine(value, duplicateCustomerNames) && (
                  <span className="px-1 text-[var(--content-quaternary)]">·</span>
                )}
                {getCustomerTertiaryLine(value, duplicateCustomerNames) && (
                  <span>{getCustomerTertiaryLine(value, duplicateCustomerNames)}</span>
                )}
              </span>
            )}
          </>
        )}
      </SelectTrigger>

      {open && (
        <BottomSheet
          isOpen={open}
          onClose={closeSheet}
          title={mode === 'create' ? 'Add customer' : 'Customers'}
          sheetClassName="h-[62vh] max-h-[62vh]"
          contentClassName={mode === 'search' ? '!px-0 !pb-0' : ''}
          keyboardBehavior="static"
        >
          {mode === 'search' ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 space-y-4 px-5 pb-4">
                <div className="relative">
                  <MagnifyingGlass
                    size={18}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--content-tertiary)]"
                  />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by customer, city, or address…"
                    className="w-full min-h-14 rounded-2xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] pl-10 pr-4 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                  />
                </div>

                {value && (
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-ds-label-size font-semibold uppercase tracking-[0.08em] text-[var(--content-tertiary)]">
                          Selected
                        </p>
                        <p className="mt-1 font-ds-lead font-semibold text-[var(--content-primary)]">
                          {value.name}
                        </p>
                        {(getCustomerSecondaryLine(value, duplicateCustomerNames) || getCustomerTertiaryLine(value, duplicateCustomerNames)) && (
                          <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                            {getCustomerSecondaryLine(value, duplicateCustomerNames) && (
                              <span className="font-medium text-[var(--content-secondary)]">
                                {getCustomerSecondaryLine(value, duplicateCustomerNames)}
                              </span>
                            )}
                            {getCustomerSecondaryLine(value, duplicateCustomerNames) && getCustomerTertiaryLine(value, duplicateCustomerNames) && (
                              <span className="px-1 text-[var(--content-quaternary)]">·</span>
                            )}
                            {getCustomerTertiaryLine(value, duplicateCustomerNames) && (
                              <span>{getCustomerTertiaryLine(value, duplicateCustomerNames)}</span>
                            )}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onChange(null)}
                        className="shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="font-ds-label-size font-semibold uppercase tracking-[0.08em] text-[var(--content-tertiary)]">
                    {query.trim() ? 'Matches' : 'Customers'}
                  </p>
                  <div className="flex items-center gap-3">
                    {!isLoading && filtered.length > 0 && (
                      <p className="text-xs text-[var(--content-tertiary)]">
                        {filtered.length} shown
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => startCreateMode(query)}
                      className="text-xs font-semibold text-[var(--content-accent)]"
                    >
                      {query.trim() && !hasExactMatch ? `Add "${query.trim()}"` : 'Add new'}
                    </button>
                  </div>
                </div>

                {isLoading ? (
                  <p className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--content-tertiary)]">
                    Loading customers…
                  </p>
                ) : filtered.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[var(--border-opaque)] bg-[var(--bg-secondary)] p-5 text-center">
                    <p className="text-sm font-semibold text-[var(--content-primary)]">
                      No customers found
                    </p>
                    <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                      Create a new customer to keep the order moving.
                    </p>
                  </div>
                ) : (
                  filtered.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onChange(c);
                        closeSheet();
                      }}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                        value?.id === c.id
                          ? 'border-[color-mix(in_srgb,var(--bg-accent)_34%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--bg-accent)_8%,white)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-ds-lead font-semibold text-[var(--content-primary)]">
                            {c.name}
                          </p>
                          {(getCustomerSecondaryLine(c, duplicateCustomerNames) || getCustomerTertiaryLine(c, duplicateCustomerNames)) && (
                            <p className="mt-1 line-clamp-1 text-sm text-[var(--content-tertiary)]">
                              {getCustomerSecondaryLine(c, duplicateCustomerNames) && (
                                <span className="font-medium text-[var(--content-secondary)]">
                                  {getCustomerSecondaryLine(c, duplicateCustomerNames)}
                                </span>
                              )}
                              {getCustomerSecondaryLine(c, duplicateCustomerNames) && getCustomerTertiaryLine(c, duplicateCustomerNames) && (
                                <span className="px-1 text-[var(--content-quaternary)]">·</span>
                              )}
                              {getCustomerTertiaryLine(c, duplicateCustomerNames) && (
                                <span>{getCustomerTertiaryLine(c, duplicateCustomerNames)}</span>
                              )}
                            </p>
                          )}
                        </div>
                        {value?.id === c.id && (
                          <CheckCircle size={20} weight="fill" className="shrink-0 text-[var(--content-accent)]" />
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
              <div className="rounded-2xl border border-[color-mix(in_srgb,var(--bg-accent)_18%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--bg-accent)_6%,white)] px-4 py-3">
                <p className="text-sm font-semibold text-[var(--content-accent)]">
                  Create a customer and return straight to the order.
                </p>
                <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                  Keep it lightweight now. We can capture advanced details later.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-[var(--content-secondary)]">
                    Customer name
                  </label>
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="Party name"
                    className="w-full min-h-14 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-[var(--content-secondary)]">
                    City
                  </label>
                  <input
                    type="text"
                    value={draftCity}
                    onChange={(e) => setDraftCity(e.target.value)}
                    placeholder="Optional"
                    className="w-full min-h-14 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-[var(--content-secondary)]">
                    Mobile
                  </label>
                  <input
                    type="tel"
                    value={draftMobile}
                    onChange={(e) => setDraftMobile(e.target.value)}
                    placeholder="Optional"
                    className="w-full min-h-14 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 text-base text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] outline-none focus:ring-1 focus:ring-[var(--border-opaque)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <BigButton
                  type="button"
                  variant="secondary"
                  onClick={() => setMode('search')}
                >
                  Back
                </BigButton>
                <BigButton
                  type="submit"
                  loading={createCustomerMutation.isPending}
                >
                  Create
                </BigButton>
              </div>
            </form>
          )}
        </BottomSheet>
      )}
    </div>
  );
}

const SWIPE_ACTION_BUTTON_WIDTH = 80;
const SWIPE_ACTION_WIDTH = SWIPE_ACTION_BUTTON_WIDTH * 2;
const SWIPE_OPEN_THRESHOLD = 64;
const SWIPE_PREVIEW_OFFSET = 36;

function SpecialRateChip() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--bg-accent-subtle)] px-3 py-1.5 font-ds-caption-size font-semibold leading-none text-[var(--content-accent)]">
      Special rate
    </span>
  );
}

function FocChip({ qty }: { qty: number }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-3 py-1.5 font-ds-caption-size font-semibold leading-none text-[var(--content-positive)]">
      FOC ×{qty}
    </span>
  );
}

// ---------------------------------------------------------------------------
// BillingItemCard — shows items that ship from stock. Qty remains editable,
// while any PO remainder on the same line is preserved in the split cart.
// Swipe for rate / delete.
// ---------------------------------------------------------------------------
interface BillingItemCardProps {
  item: CartItem;
  shipQty: number;
  poQty: number;
  shippedPaid: number;
  shippedFoc: number;
  focQty: number;
  showFocControls: boolean;
  onChangeFocQty: (lineId: string, next: number) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onChangeShipQty: (lineId: string, newShipQty: number) => void;
  onRatePress: (item: CartItem) => void;
  onDeletePress: (item: CartItem) => void;
  previewOnMount?: boolean;
}

const BillingItemCard = memo(function BillingItemCard({
  item: cartItem,
  shipQty,
  poQty,
  shippedPaid,
  shippedFoc,
  focQty,
  showFocControls,
  onChangeFocQty,
  isOpen,
  onOpenChange,
  onChangeShipQty,
  onRatePress,
  onDeletePress,
  previewOnMount = false,
}: BillingItemCardProps) {
  const [offset, setOffset] = useState(isOpen ? SWIPE_ACTION_WIDTH : 0);
  const [isDragging, setIsDragging] = useState(false);
  const [previewOffset, setPreviewOffset] = useState(0);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const baseOffsetRef = useRef(0);
  const isHorizontalGestureRef = useRef(false);
  const hasPreviewedRef = useRef(false);

  useEffect(() => {
    if (!previewOnMount || hasPreviewedRef.current) return;
    hasPreviewedRef.current = true;

    const previewIn = window.setTimeout(() => {
      setPreviewOffset(SWIPE_PREVIEW_OFFSET);
    }, 350);
    const previewOut = window.setTimeout(() => {
      setPreviewOffset(0);
    }, 1050);

    return () => {
      window.clearTimeout(previewIn);
      window.clearTimeout(previewOut);
    };
  }, [previewOnMount]);

  const closeActions = useCallback(() => {
    setOffset(0);
    setPreviewOffset(0);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    baseOffsetRef.current = isOpen ? SWIPE_ACTION_WIDTH : 0;
    isHorizontalGestureRef.current = false;
    setPreviewOffset(0);
    setIsDragging(true);
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;

    const touch = event.touches[0];
    const deltaX = startXRef.current - touch.clientX;
    const deltaY = Math.abs(startYRef.current - touch.clientY);

    if (!isHorizontalGestureRef.current) {
      if (Math.abs(deltaX) < 4) return;
      if (Math.abs(deltaX) <= deltaY) {
        setIsDragging(false);
        return;
      }
      isHorizontalGestureRef.current = true;
    }

    const nextOffset = Math.min(
      SWIPE_ACTION_WIDTH,
      Math.max(0, baseOffsetRef.current + (deltaX * 1.15)),
    );
    setOffset(nextOffset);
    event.preventDefault();
  };

  const handleTouchEnd = () => {
    if (isHorizontalGestureRef.current) {
      if (offset >= SWIPE_OPEN_THRESHOLD) {
        setOffset(SWIPE_ACTION_WIDTH);
        onOpenChange(true);
      } else {
        closeActions();
      }
    }

    setIsDragging(false);
    startXRef.current = null;
    startYRef.current = null;
    isHorizontalGestureRef.current = false;
  };

  const price = cartItem.specialRate ?? cartItem.item.sales_price;
  const partNo = cartItem.item.alias1 ?? cartItem.item.alias;
  const hasSpecialRate = cartItem.specialRate !== null;
  const hasFoc = focQty > 0;
  const lineTotal = price * shippedPaid;

  return (
    <li className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 flex">
        <button
          type="button"
          onClick={() => onRatePress(cartItem)}
          className="flex w-20 flex-col items-center justify-center gap-1 border-l border-[color:color-mix(in_srgb,var(--role-primary)_22%,var(--border-subtle))] bg-[var(--role-primary-subtle)] text-[var(--role-content)]"
          aria-label={`Set special rate for ${cartItem.item.name}`}
        >
          <CurrencyInr size={20} weight="bold" />
          <span className="text-xs font-semibold">Rate</span>
        </button>
        <button
          type="button"
          onClick={() => onDeletePress(cartItem)}
          className="flex w-20 flex-col items-center justify-center gap-1 border-l border-[color:color-mix(in_srgb,var(--bg-negative)_28%,var(--border-subtle))] bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]"
          aria-label={`Delete ${cartItem.item.name}`}
        >
          <Trash size={20} weight="bold" />
          <span className="text-xs font-semibold">Delete</span>
        </button>
      </div>

      <div
        className={`relative bg-[var(--bg-secondary)] px-4 py-4 ${isDragging ? '' : 'transition-transform duration-180 ease-out'} ${isOpen || isDragging ? 'z-10 shadow-[0_8px_20px_rgba(15,23,42,0.06)]' : ''}`}
        style={{ transform: `translate3d(-${isDragging ? offset : (isOpen ? SWIPE_ACTION_WIDTH : previewOffset)}px, 0, 0)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onClick={() => {
          if (isOpen && !isDragging) {
            closeActions();
          }
        }}
      >
        <div className="min-w-0">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              {partNo && (
                <p className="inline-flex max-w-full items-center truncate rounded-full border border-[var(--border-faint)] bg-[color:color-mix(in_srgb,var(--bg-tertiary)_72%,white)] px-3 py-1.5 font-mono font-ds-label-size font-semibold tracking-[0.04em] text-[var(--content-secondary)]">
                  {partNo}
                </p>
              )}
              <p className="mt-2.5 text-base font-semibold leading-[1.35] text-[var(--content-primary)] whitespace-normal break-words line-clamp-2">
                {cartItem.item.name}
              </p>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {hasSpecialRate && <SpecialRateChip />}
                {hasFoc && <FocChip qty={focQty} />}
                {hasSpecialRate && (
                  <span className="font-mono font-ds-micro text-[var(--content-tertiary)] line-through">
                    {formatCurrency(cartItem.item.sales_price)}
                  </span>
                )}
              </div>
              {shippedFoc > 0 && (
                <p className="mt-1.5 font-ds-micro font-medium text-[var(--content-positive)]">
                  Includes {shippedFoc} FOC from stock (₹0)
                </p>
              )}
            </div>

            <div className="shrink-0 flex min-w-[142px] flex-col items-end gap-3.5 pl-4">
              <div className="text-right">
                <p className="font-ds-micro font-medium uppercase tracking-[0.08em] text-[var(--content-tertiary)]">
                  Total
                </p>
                <p className="mt-1 font-mono text-base font-semibold leading-none text-[var(--content-primary)]">
                  {formatCurrency(lineTotal)}
                </p>
              </div>
              <div className="flex w-full justify-end">
                <NumberStepper
                  value={shipQty}
                  onChange={(newShipQty) => onChangeShipQty(cartItem.lineId, newShipQty)}
                  min={poQty > 0 ? 0 : 1}
                  presets={[]}
                  variant="compact"
                  showRemoveAtMin={poQty === 0}
                  onRemove={poQty === 0 ? () => onDeletePress(cartItem) : undefined}
                />
              </div>
            </div>
          </div>
          {showFocControls && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-3 py-2">
              <p className="text-xs font-semibold text-[var(--content-positive)]">Free qty (FOC)</p>
              <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                <NumberStepper
                  value={focQty}
                  onChange={(n) => onChangeFocQty(cartItem.lineId, n)}
                  min={0}
                  presets={[]}
                  variant="compact"
                  colorScheme="positive"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
});

// ---------------------------------------------------------------------------
// PurchaseOrderCard — editable stepper for PO qty. Swipe for rate / delete
// (same pattern as billed lines). For PO-only items, stepper still offers
// remove at min qty.
// ---------------------------------------------------------------------------
interface PurchaseOrderCardProps {
  cartItem: CartItem;
  poQty: number;
  shipQty: number;
  poPaid: number;
  poFoc: number;
  focQty: number;
  showFocControls: boolean;
  onChangeFocQty: (lineId: string, next: number) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onChangePoQty: (lineId: string, newPoQty: number) => void;
  onRatePress: (item: CartItem) => void;
  onDeletePress: (item: CartItem) => void;
}

const PurchaseOrderCard = memo(function PurchaseOrderCard({
  cartItem,
  poQty,
  shipQty,
  poPaid,
  poFoc,
  focQty,
  showFocControls,
  onChangeFocQty,
  isOpen,
  onOpenChange,
  onChangePoQty,
  onRatePress,
  onDeletePress,
}: PurchaseOrderCardProps) {
  const [offset, setOffset] = useState(isOpen ? SWIPE_ACTION_WIDTH : 0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const baseOffsetRef = useRef(0);
  const isHorizontalGestureRef = useRef(false);
  const displayOffset = isDragging ? offset : (isOpen ? SWIPE_ACTION_WIDTH : 0);

  const closeActions = useCallback(() => {
    setOffset(0);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0];
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    baseOffsetRef.current = isOpen ? SWIPE_ACTION_WIDTH : 0;
    isHorizontalGestureRef.current = false;
    setIsDragging(true);
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;

    const touch = event.touches[0];
    const deltaX = startXRef.current - touch.clientX;
    const deltaY = Math.abs(startYRef.current - touch.clientY);

    if (!isHorizontalGestureRef.current) {
      if (Math.abs(deltaX) < 4) return;
      if (Math.abs(deltaX) <= deltaY) {
        setIsDragging(false);
        return;
      }
      isHorizontalGestureRef.current = true;
    }

    const nextOffset = Math.min(
      SWIPE_ACTION_WIDTH,
      Math.max(0, baseOffsetRef.current + (deltaX * 1.15)),
    );
    setOffset(nextOffset);
    event.preventDefault();
  };

  const handleTouchEnd = () => {
    if (isHorizontalGestureRef.current) {
      if (offset >= SWIPE_OPEN_THRESHOLD) {
        setOffset(SWIPE_ACTION_WIDTH);
        onOpenChange(true);
      } else {
        closeActions();
      }
    }

    setIsDragging(false);
    startXRef.current = null;
    startYRef.current = null;
    isHorizontalGestureRef.current = false;
  };

  const partNo = cartItem.item.alias1 ?? cartItem.item.alias;
  const fullyPo = shipQty === 0;

  return (
    <li className="relative overflow-hidden rounded-2xl">
      <div className="absolute inset-y-0 right-0 flex">
        <button
          type="button"
          onClick={() => onRatePress(cartItem)}
          className="flex w-20 flex-col items-center justify-center gap-1 border-l border-[color-mix(in_srgb,var(--role-primary)_22%,var(--border-subtle))] bg-[var(--role-primary-subtle)] text-[var(--role-content)]"
          aria-label={`Set special rate for ${cartItem.item.name}`}
        >
          <CurrencyInr size={20} weight="bold" />
          <span className="text-xs font-semibold">Rate</span>
        </button>
        <button
          type="button"
          onClick={() => onDeletePress(cartItem)}
          className="flex w-20 flex-col items-center justify-center gap-1 border-l border-[color-mix(in_srgb,var(--bg-negative)_28%,var(--border-subtle))] bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]"
          aria-label={`Delete ${cartItem.item.name}`}
        >
          <Trash size={20} weight="bold" />
          <span className="text-xs font-semibold">Delete</span>
        </button>
      </div>

      <div
        className={`relative rounded-2xl border border-[color-mix(in_srgb,var(--border-warning)_42%,var(--border-subtle))] bg-[var(--bg-warning-subtle)] px-4 py-3.5 ${isDragging ? '' : 'transition-transform duration-180 ease-out'} ${isOpen || isDragging ? 'z-10 shadow-[0_8px_20px_rgba(15,23,42,0.06)]' : ''}`}
        style={{ transform: `translate3d(-${displayOffset}px, 0, 0)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onClick={() => {
          if (isOpen && !isDragging) {
            closeActions();
          }
        }}
      >
        <div>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              {partNo && (
                <span className="inline-flex max-w-full shrink-0 items-center truncate rounded-full border border-[color-mix(in_srgb,var(--content-primary)_12%,var(--border-subtle))] bg-[var(--bg-secondary)] px-3 py-1 font-mono font-ds-label-size font-semibold tracking-[0.04em] text-[var(--content-primary)]">
                  {partNo}
                </span>
              )}
              <p className="mt-1.5 font-ds-body-size font-semibold leading-[1.35] text-[var(--content-primary)] line-clamp-2 break-words">
                {cartItem.item.name}
              </p>
              {poFoc > 0 && (
                <p className="mt-1 font-ds-micro font-medium text-[var(--content-positive)]">
                  {poPaid > 0 ? `${poPaid} paid · ` : ''}
                  {poFoc} FOC on PO (₹0)
                </p>
              )}
            </div>
            <div className="shrink-0">
              <NumberStepper
                value={poQty}
                onChange={(q) => onChangePoQty(cartItem.lineId, q)}
                min={fullyPo ? 1 : 0}
                presets={[]}
                variant="compact"
                showRemoveAtMin={fullyPo}
                onRemove={fullyPo ? () => onDeletePress(cartItem) : undefined}
              />
            </div>
          </div>
          {showFocControls && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-positive)] bg-[color-mix(in_srgb,var(--bg-positive-subtle)_85%,var(--bg-warning-subtle))] px-3 py-2">
              <p className="text-xs font-semibold text-[var(--content-positive)]">Free qty (FOC)</p>
              <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                <NumberStepper
                  value={focQty}
                  onChange={(n) => onChangeFocQty(cartItem.lineId, n)}
                  min={0}
                  presets={[]}
                  variant="compact"
                  colorScheme="positive"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
});

// ---------------------------------------------------------------------------
// CartPage
// ---------------------------------------------------------------------------
export default function CartPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const routes = useOrderRoutes();
  const goToNewOrderWithSearchFocus = useCallback(() => {
    navigate(routes.items, { state: { focusSearch: true } });
  }, [navigate, routes.items]);
  const queryClient = useQueryClient();
  const {
    items,
    updateQty,
    updateFocQty,
    removeItem,
    setSpecialRate,
    clearCart,
    selectedCustomer: customer,
    setSelectedCustomer: setCustomer,
    selectedTransport: transport,
    setSelectedTransport: setTransport,
    priority,
    setPriority,
    notes,
    setNotes,
  } = useCart();
  const toast = useToast();
  const { userId, userName } = useOrderAuthor();
  const { userId: authUserId, userName: authUserName } = useAuth();
  const {
    data: sellableLocationCode = 'main_store',
    isLoading: stockLocationLoading,
  } = useUserStockLocation(userId, userName);
  const { data: transports = [] } = useTransports();
  const isOnBehalf = userId !== null && authUserId !== null && userId !== authUserId;

  const [submitSuccess, setSubmitSuccess] = useState<{
    orderNumber: string;
    shareText: string;
  } | null>(null);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const summaryCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showItemBreakdown, setShowItemBreakdown] = useState(false);
  const [openActionsItemId, setOpenActionsItemId] = useState<string | null>(null);
  const [openPoActionsItemId, setOpenPoActionsItemId] = useState<string | null>(null);
  const [rateItemId, setRateItemId] = useState<string | null>(null);
  const [rateValue, setRateValue] = useState('');
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);

  const rateCartItem = rateItemId !== null ? items.find((ci) => ci.lineId === rateItemId) ?? null : null;
  const deleteCartItem = deleteItemId !== null ? items.find((ci) => ci.lineId === deleteItemId) ?? null : null;
  const visibleBusyCodes = useMemo(
    () => items.map((ci) => ci.item.busy_code),
    [items],
  );
  const hasLocationwiseLines = useMemo(
    () => visibleBusyCodes.some((code) => code != null && Number.isFinite(Number(code))),
    [visibleBusyCodes],
  );
  const normalizedVisibleBusyCodes = useMemo(
    () => normalizeBusyCodes(visibleBusyCodes),
    [visibleBusyCodes],
  );
  const {
    data: locationwiseStock = {},
    isFetching: locationwiseStockFetching,
  } = useLocationwiseStock(visibleBusyCodes);
  const stockSplitLoading =
    stockLocationLoading ||
    (hasLocationwiseLines &&
      normalizedVisibleBusyCodes.some((code) =>
        isLocationwiseStockResolving(code, locationwiseStockFetching),
      ));

  /** Single pass over lines: splits, billing/PO lists, totals (one stock calc per line). */
  const {
    billingSplits,
    poSplits,
    billingCount,
    billingTotal,
    poPiecesTotal,
    splitByLineId,
  } = useMemo(() => {
    const billingSplits: { ci: CartItem; ship: number; po: number }[] = [];
    const poSplits: { ci: CartItem; ship: number; po: number }[] = [];
    const splitByLineId = new Map<
      string,
      {
        ship: number;
        po: number;
        shippedPaid: number;
        shippedFoc: number;
        poPaid: number;
        poFoc: number;
      }
    >();
    const remainingByBusyCode = new Map<number, number | null>();
    let billingCount = 0;
    let billingTotal = 0;
    let poPiecesTotal = 0;
    for (const ci of items) {
      const busyCode = ci.item.busy_code == null ? NaN : Number(ci.item.busy_code);
      let stockQty: number | null = null;
      if (Number.isFinite(busyCode)) {
        if (remainingByBusyCode.has(busyCode)) {
          stockQty = remainingByBusyCode.get(busyCode) ?? null;
        } else {
          stockQty = getStockQtyForLocation(locationwiseStock[busyCode], sellableLocationCode);
        }
      }
      const split = splitCartLinePaidFoc(ci.qty, ci.focQty ?? 0, stockQty);
      const { ship, po, shippedPaid } = split;
      if (Number.isFinite(busyCode) && stockQty != null) {
        remainingByBusyCode.set(busyCode, Math.max(0, stockQty - ship));
      }
      splitByLineId.set(ci.lineId, split);
      if (ship > 0) billingSplits.push({ ci, ship, po });
      if (po > 0) poSplits.push({ ci, ship, po });
      billingCount += ship;
      billingTotal += (ci.specialRate ?? ci.item.sales_price) * shippedPaid;
      poPiecesTotal += po;
    }
    return {
      billingSplits,
      poSplits,
      billingCount,
      billingTotal,
      poPiecesTotal,
      splitByLineId,
    };
  }, [items, locationwiseStock, sellableLocationCode]);

  const billingLineIdsWithShip = useMemo(
    () => new Set(billingSplits.map((r) => r.ci.lineId)),
    [billingSplits],
  );

  /** When PO stepper changes, adjust total qty; ship from stock stays implied by item + stock. */
  const handlePoQtyChange = useCallback(
    (lineId: string, newPoQty: number) => {
      const ci = items.find((c) => c.lineId === lineId);
      if (!ci) return;
      const split = splitByLineId.get(lineId);
      if (!split) return;
      const newTotal = split.ship + Math.max(0, newPoQty);
      reconcileLineToTotalPieces(ci, newTotal, { updateQty, updateFocQty, removeItem });
    },
    [items, splitByLineId, updateQty, updateFocQty, removeItem],
  );

  const handleShipQtyChange = useCallback(
    (lineId: string, newShipQty: number) => {
      const ci = items.find((c) => c.lineId === lineId);
      if (!ci) return;
      const split = splitByLineId.get(lineId);
      if (!split) return;
      const newTotal = Math.max(0, newShipQty) + split.po;
      reconcileLineToTotalPieces(ci, newTotal, { updateQty, updateFocQty, removeItem });
    },
    [items, splitByLineId, updateQty, updateFocQty, removeItem],
  );

  const handleFocQtyChange = useCallback(
    (lineId: string, next: number) => {
      updateFocQty(lineId, Math.max(0, Math.floor(next)));
    },
    [updateFocQty],
  );

  const openRateSheet = useCallback((cartItem: CartItem) => {
    setOpenActionsItemId(null);
    setOpenPoActionsItemId(null);
    setRateItemId(cartItem.lineId);
    setRateValue(cartItem.specialRate !== null ? String(cartItem.specialRate) : '');
  }, []);

  const handleSaveRate = useCallback(() => {
    if (!rateCartItem) return;
    appHaptics.impactMedium();
    const parsed = parseFloat(rateValue.replace(/,/g, ''));
    setSpecialRate(rateCartItem.lineId, Number.isNaN(parsed) || parsed < 0 ? null : parsed);
    setRateItemId(null);
  }, [rateCartItem, rateValue, setSpecialRate]);

  const openDeleteSheet = useCallback((cartItem: CartItem) => {
    setOpenActionsItemId(null);
    setOpenPoActionsItemId(null);
    setDeleteItemId(cartItem.lineId);
  }, []);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!customer || !userName) throw new Error('Customer and salesperson required');

      const submittedAt = new Date();

      const payload = {
        customer_id: customer.id,
        customer_name: customer.name,
        customer_city: customer.city ?? null,
        transport_id: transport?.id ?? null,
        transport_name: transport?.name ?? null,
        salesperson_name: userName,
        salesperson_user_id: userId,
        priority,
        notes: notes.trim() || null,
        lines: items.flatMap((ci) => {
          const foc = Math.max(0, ci.focQty ?? 0);
          const paid = ci.qty;
          const sys = ci.item.sales_price;
          const rows: Array<{
            item_id: number;
            qty_requested: number;
            price_quoted: number;
            price_system: number;
            is_foc: boolean;
          }> = [];
          if (paid > 0) {
            rows.push({
              item_id: ci.item.id,
              qty_requested: paid,
              price_quoted: ci.specialRate ?? sys,
              price_system: sys,
              is_foc: false,
            });
          }
          if (foc > 0) {
            rows.push({
              item_id: ci.item.id,
              qty_requested: foc,
              price_quoted: 0,
              price_system: sys,
              is_foc: true,
            });
          }
          return rows;
        }),
      };

      const { data: rpcData, error: rpcError } = await supabase.rpc('submit_sales_order', {
        p_payload: payload,
      });

      if (rpcError) throw rpcError;

      const result = rpcData as {
        success?: boolean;
        error?: string;
        detail?: string;
        order_id?: number;
        order_number?: string;
        lines?: Array<{
          name: string;
          qty_requested: number;
          qty_ship: number;
          qty_po: number;
          is_foc?: boolean;
        }>;
      };

      if (!result?.success) {
        throw new Error(
          submitSalesOrderErrorMessage(result?.error, result?.detail),
        );
      }

      const orderNumber = result.order_number;
      if (!orderNumber) throw new Error('Order submit returned no order number');

      const envBiz = import.meta.env.VITE_BUSINESS_DISPLAY_NAME;
      const businessName =
        typeof envBiz === 'string' && envBiz.trim() !== '' ? envBiz.trim() : undefined;

      const linesForMessage: OrderCustomerShareLine[] = (result.lines ?? []).map((row) => ({
        name: row.name,
        qtyRequested: row.qty_requested,
        qtyShip: row.qty_ship,
        qtyPo: row.qty_po,
        isFoc: row.is_foc ?? false,
      }));

      const shareTextFinal = buildOrderCustomerMessage({
        customerName: customer.name,
        date: submittedAt,
        lines: linesForMessage,
        businessName,
      });

      if (isOnBehalf && typeof result.order_id === 'number') {
        const enteredBy = authUserName?.trim() ? authUserName.trim() : 'the billing team';
        void sendInternalNotification({
          eventType: 'order_update_for_sales',
          orderId: result.order_id,
          orderNumber,
          customerName: customer.name,
          salespersonName: userName,
          messageBody: `New order ${orderNumber} for ${customer.name} entered on your behalf by ${enteredBy}.`,
        }).catch((e) => {
          console.error('order_created_on_behalf notification', e);
          toast.error(
            `Salesperson notification failed: ${formatInternalNotificationError(e)}`,
          );
        });
      }

      return {
        orderNumber,
        shareText: shareTextFinal,
      };
    },
    onSuccess: (payload) => {
      clearCart();
      setSummaryCopied(false);
      if (summaryCopyTimeoutRef.current) {
        clearTimeout(summaryCopyTimeoutRef.current);
        summaryCopyTimeoutRef.current = null;
      }
      setSubmitSuccess(payload);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] });
      void invalidateLocationwiseStockQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ITEMS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['customer_quick_reorder'] });
      queryClient.invalidateQueries({ queryKey: ['salesperson_top_customers'] });
      queryClient.invalidateQueries({ queryKey: ['trending_items'] });
      // Push the same refreshes to every other tab on this device — instant
      // cross-tab updates even when wss:// is blocked.
      broadcastItemsChanged();
      broadcastInvalidate(['orders']);
    },
    onError: (e) => {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? String((e as { message: unknown }).message)
            : 'Failed to submit order';
      toast.error(msg);
    },
  });

  const handleSubmit = () => {
    appHaptics.impactMedium();
    submitMutation.mutate();
  };

  useEffect(() => {
    return () => {
      if (summaryCopyTimeoutRef.current) {
        clearTimeout(summaryCopyTimeoutRef.current);
      }
    };
  }, []);

  const copySummaryToClipboard = useCallback(async () => {
    if (!submitSuccess) return;
    try {
      await navigator.clipboard.writeText(submitSuccess.shareText);
      setSummaryCopied(true);
      if (summaryCopyTimeoutRef.current) clearTimeout(summaryCopyTimeoutRef.current);
      summaryCopyTimeoutRef.current = setTimeout(() => {
        setSummaryCopied(false);
        summaryCopyTimeoutRef.current = null;
      }, 2000);
    } catch {
      toast.error('Could not copy');
    }
  }, [submitSuccess, toast]);

  // Success screen
  if (submitSuccess) {
    const waUrl = whatsappPrefilledUrl(submitSuccess.shareText);

    return (
      <div className="min-h-screen flex flex-col">
        <PageHeader
          title="Order Submitted"
          onBack={() => {
            setSubmitSuccess(null);
            navigate(routes.home);
          }}
        />
        <div className="flex-1 flex flex-col p-6 pb-10 min-h-0">
          <div className="flex flex-col items-center text-center shrink-0">
            <div className="w-16 h-16 rounded-full bg-[var(--bg-positive-subtle)] flex items-center justify-center mb-4">
              <CheckCircle size={36} weight="fill" className="text-[var(--content-positive)]" />
            </div>
            <h2 className="text-xl font-bold text-[var(--content-primary)] mb-1">
              Order Submitted
            </h2>
            <p className="text-2xl sm:text-3xl font-bold font-mono text-[var(--content-accent)] mb-3">
              {submitSuccess.orderNumber}
            </p>
            <p className="text-sm text-[var(--content-tertiary)] max-w-md mb-3">
              Share the summary below with your customer (billed vs pending as of submit time). WhatsApp
              opens with the text ready — choose the party in WhatsApp and send.
            </p>
          </div>

          <div className="w-full max-w-lg mx-auto flex flex-col gap-3 shrink-0">
            <div className="relative rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
              <button
                type="button"
                onClick={() => void copySummaryToClipboard()}
                aria-label={summaryCopied ? 'Copied to clipboard' : 'Copy summary to clipboard'}
                className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] active:bg-[var(--bg-tertiary)] transition-colors"
              >
                {summaryCopied ? (
                  <>
                    <Check size={16} weight="bold" className="text-[var(--content-positive)]" />
                    <span className="text-[var(--content-positive)]">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={16} weight="bold" />
                    <span>Copy</span>
                  </>
                )}
              </button>
              <pre className="max-h-[min(11rem,28dvh)] overflow-y-auto overscroll-y-contain text-left font-ds-prose leading-relaxed text-[var(--content-secondary)] whitespace-pre-wrap break-words pt-11 pr-3 pb-3 pl-4 [scrollbar-gutter:stable]">
                {submitSuccess.shareText}
              </pre>
            </div>
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full min-h-14 flex items-center justify-center gap-2 rounded-2xl font-semibold bg-[var(--bg-positive)] text-[var(--content-on-color)] hover:opacity-95 active:scale-[0.99] transition-all"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Send via WhatsApp
            </a>
            <BigButton
              variant="primary"
              onClick={() => {
                setSubmitSuccess(null);
                navigate(routes.items);
              }}
            >
              Create Another
            </BigButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <PageHeader
        title="Your Order"
        onBack={() => navigate(routes.items)}
      />

      <div className={`flex-1 space-y-6 p-4 ${items.length > 0 ? 'pb-48' : ''}`}>
        {items.length === 0 ? (
          <div className="py-16 flex flex-col items-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-tertiary)]">
              <ShoppingCartIcon size={30} weight="light" className="text-[var(--content-quaternary)]" />
            </div>
            <div>
              <p className="font-semibold text-[var(--content-primary)]">No items yet</p>
              <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                Search for products and tap the + button to add them.
              </p>
            </div>
            <BigButton variant="secondary" onClick={goToNewOrderWithSearchFocus}>
              Browse Items
            </BigButton>
          </div>
        ) : (
          <>
            {/* Billing items — what ships from stock */}
            {billingSplits.length > 0 && (
              <section>
                <div className="mb-3.5 flex items-end justify-between gap-3 px-1">
                  <div>
                    <h2 className="text-base font-semibold text-[var(--content-primary)]">
                      Ready to bill
                    </h2>
                    <p className="mt-0.5 text-sm text-[var(--content-tertiary)]">
                      In stock and included in this bill now
                    </p>
                  </div>
                  <p className="text-sm text-[var(--content-tertiary)]">
                    {billingSplits.length} line{billingSplits.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <ul className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] divide-y divide-[var(--border-subtle)]">
                  {billingSplits.map((row) => {
                    const split = splitByLineId.get(row.ci.lineId);
                    const shippedPaid = split?.shippedPaid ?? Math.min(row.ci.qty, row.ship);
                    const shippedFoc = split?.shippedFoc ?? Math.max(0, row.ship - shippedPaid);
                    return (
                      <BillingItemCard
                        key={row.ci.lineId}
                        item={row.ci}
                        shipQty={row.ship}
                        poQty={row.po}
                        shippedPaid={shippedPaid}
                        shippedFoc={shippedFoc}
                        focQty={row.ci.focQty ?? 0}
                        showFocControls
                        onChangeFocQty={handleFocQtyChange}
                        isOpen={openActionsItemId === row.ci.lineId}
                        onOpenChange={(open) => {
                          if (open) setOpenPoActionsItemId(null);
                          setOpenActionsItemId(open ? row.ci.lineId : null);
                        }}
                        onChangeShipQty={handleShipQtyChange}
                        onRatePress={openRateSheet}
                        onDeletePress={openDeleteSheet}
                        previewOnMount={row === billingSplits[0]}
                      />
                    );
                  })}
                </ul>
                <button
                  type="button"
                  onClick={goToNewOrderWithSearchFocus}
                  className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[color:color-mix(in_srgb,var(--role-primary)_18%,var(--border-subtle))] bg-[color:color-mix(in_srgb,var(--role-primary)_5%,white)] px-4 py-3 text-sm font-semibold text-[var(--role-content)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--role-primary)_8%,white)]"
                >
                  <Plus size={18} weight="bold" />
                  <span>Add items</span>
                </button>
              </section>
            )}

            {/* Purchase order — editable qty */}
            {poSplits.length > 0 && (
              <section>
                <div className="mb-3.5 flex items-end justify-between gap-3 px-1">
                  <div>
                    <h2 className="text-base font-semibold text-[var(--content-warning)]">Purchase order</h2>
                    <p className="mt-0.5 text-sm text-[var(--content-tertiary)]">
                      Not in stock and needs procurement
                    </p>
                  </div>
                  <p className="text-sm text-[var(--content-tertiary)]">
                    {poSplits.length} line{poSplits.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <ul className="space-y-2">
                  {poSplits.map((row) => (
                    <PurchaseOrderCard
                      key={`${row.ci.lineId}-po`}
                      cartItem={row.ci}
                      poQty={row.po}
                      shipQty={row.ship}
                      poPaid={splitByLineId.get(row.ci.lineId)?.poPaid ?? row.ci.qty}
                      poFoc={splitByLineId.get(row.ci.lineId)?.poFoc ?? (row.ci.focQty ?? 0)}
                      focQty={row.ci.focQty ?? 0}
                      showFocControls={!billingLineIdsWithShip.has(row.ci.lineId)}
                      onChangeFocQty={handleFocQtyChange}
                      isOpen={openPoActionsItemId === row.ci.lineId}
                      onOpenChange={(open) => {
                        if (open) setOpenActionsItemId(null);
                        setOpenPoActionsItemId(open ? row.ci.lineId : null);
                      }}
                      onChangePoQty={handlePoQtyChange}
                      onRatePress={openRateSheet}
                      onDeletePress={openDeleteSheet}
                    />
                  ))}
                </ul>
              </section>
            )}

            {/* Empty state: all items are PO-only */}
            {billingSplits.length === 0 && poSplits.length > 0 && (
              <p className="px-1 text-sm text-[var(--content-tertiary)]">
                No items in stock for immediate billing.
              </p>
            )}

            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 space-y-5">
              <h2 className="text-base font-semibold text-[var(--content-primary)]">
                Order details
              </h2>

              {/* Customer */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--content-secondary)]">
                  Customer
                </label>
                <SearchableCustomerDropdown
                  value={customer}
                  onChange={setCustomer}
                />
              </div>

              {/* Transport */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--content-secondary)]">
                  Transport
                </label>
                <div className="relative">
                  <select
                    value={transport?.id ?? ''}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      setTransport(id ? transports.find((t) => t.id === id) ?? null : null);
                    }}
                    className="h-14 w-full appearance-none rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] pl-4 pr-10 text-[var(--content-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--border-subtle)]"
                  >
                    <option value="">Select Transport</option>
                    {transports.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <CaretDown
                    size={16}
                    className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[var(--content-tertiary)]"
                    aria-hidden
                  />
                </div>
              </div>

              {/* Priority */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--content-secondary)]">
                  Priority
                </label>
                <div className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--bg-primary)] p-1">
                  <button
                    type="button"
                    onClick={() => setPriority('normal')}
                    aria-pressed={priority === 'normal'}
                    className={`min-h-12 rounded-lg border text-sm font-semibold transition-all ${
                      priority === 'normal'
                        ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] shadow-sm'
                        : 'border-transparent bg-transparent text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <span>Normal</span>
                      {priority === 'normal' && (
                        <CheckCircle size={16} weight="fill" aria-hidden className="text-[var(--content-accent)]" />
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPriority('urgent')}
                    aria-pressed={priority === 'urgent'}
                    className={`min-h-12 rounded-lg border text-sm font-semibold transition-all ${
                      priority === 'urgent'
                        ? 'border-[var(--content-negative)] bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] shadow-sm'
                        : 'border-transparent bg-transparent text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    <span className="flex items-center justify-center gap-1.5">
                      <span>Urgent</span>
                      {priority === 'urgent' && (
                        <CheckCircle size={16} weight="fill" aria-hidden className="text-[var(--content-negative)]" />
                      )}
                    </span>
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-[var(--content-secondary)]">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Special instructions for billing…"
                  rows={3}
                  className="w-full resize-none rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3 text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] focus:outline-none focus:ring-1 focus:ring-[var(--border-subtle)]"
                />
              </div>
            </section>

            {/* Summary */}
            <div className="space-y-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
              <div className="flex justify-between items-baseline text-sm text-[var(--content-secondary)]">
                <div>
                  <span>Billing</span>
                  <span className="ml-1 text-[var(--content-tertiary)]">
                    ({billingCount} pcs)
                  </span>
                </div>
                <span className="font-mono text-[var(--content-primary)]">
                  {formatCurrency(billingTotal)}
                </span>
              </div>
              {poSplits.length > 0 && (
                <div className="flex justify-between items-baseline text-sm text-[var(--content-secondary)]">
                  <span>Purchase order</span>
                  <span className="text-xs text-[var(--content-warning)]">
                    {poPiecesTotal} pcs
                  </span>
                </div>
              )}
              <div className="flex justify-between items-baseline text-sm text-[var(--content-secondary)]">
                <div>
                  <span>Transport</span>
                  <p className="text-xs text-[var(--content-tertiary)]">
                    {transport ? transport.name : 'Not selected'}
                  </p>
                </div>
                <span className="text-[var(--content-quaternary)]">—</span>
              </div>
              <div className="border-t-2 border-[var(--border-subtle)] pt-3 mt-3 flex justify-between items-baseline">
                <span className="text-base font-bold text-[var(--content-primary)]">Grand Total</span>
                <span className="font-mono text-xl font-bold text-[var(--content-primary)]">
                  {formatCurrency(billingTotal)}
                </span>
              </div>
              <button
                type="button"
                className="mt-2 w-full flex items-center justify-between text-xs text-[var(--content-secondary)] hover:text-[var(--content-primary)] transition-colors"
                onClick={() => setShowItemBreakdown((prev) => !prev)}
              >
                <span>{showItemBreakdown ? 'Hide item-wise breakdown' : 'Show item-wise breakdown'}</span>
                {showItemBreakdown
                  ? <CaretUp size={12} aria-hidden />
                  : <CaretDown size={12} aria-hidden />
                }
              </button>
              {showItemBreakdown && (
                <div className="mt-1 pt-2 border-t border-dashed border-[var(--border-subtle)] space-y-1.5">
                  {billingSplits.map((row) => {
                    const { ci, ship } = row;
                    const price = ci.specialRate ?? ci.item.sales_price;
                    const lineTotal = price * ship;
                    const partNo = ci.item.alias1 ?? ci.item.alias;
                    return (
                      <div key={ci.lineId} className="flex justify-between gap-3 text-xs mt-1 text-[var(--content-secondary)]">
                        <div className="min-w-0">
                          <p className="truncate">
                            {ci.item.name}
                          </p>
                          {partNo && (
                            <p className="font-mono text-xs text-[var(--content-tertiary)] truncate">
                              {partNo}
                            </p>
                          )}
                          {ci.specialRate !== null && (
                            <div className="mt-1">
                              <SpecialRateChip />
                            </div>
                          )}
                        </div>
                        <div className="text-right font-mono">
                          <p>
                            {formatCurrency(price)} × {ship}
                          </p>
                          <p className="font-semibold text-[var(--content-primary)]">
                            = {formatCurrency(lineTotal)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {items.length > 0 && (
        <div
          className="fixed bottom-16 left-0 right-0 z-30 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 px-4 pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
        >
          <div className="mx-auto max-w-screen-sm rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-[var(--content-secondary)]">
                Billing total
              </p>
              <p className="font-mono text-lg font-semibold text-[var(--content-primary)]">
                {formatCurrency(billingTotal)}
              </p>
            </div>
            <BigButton
              variant="primary"
              onClick={handleSubmit}
              loading={submitMutation.isPending}
              disabled={!customer || stockSplitLoading}
            >
              Submit Order
            </BigButton>
            {!customer && !submitMutation.isPending && (
              <p className="mt-2 text-center text-xs font-medium text-[var(--content-tertiary)]">
                Select a customer above to continue
              </p>
            )}
            {stockSplitLoading && (
              <p className="mt-2 text-center text-xs font-medium text-[var(--content-tertiary)]">
                Loading {stockLocationLabel(sellableLocationCode)} stock…
              </p>
            )}
          </div>
        </div>
      )}

      <BottomSheet
        isOpen={!!rateCartItem}
        onClose={() => setRateItemId(null)}
        title={rateCartItem ? `Special rate: ${rateCartItem.item.name}` : ''}
      >
        {rateCartItem && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--content-tertiary)]">
              Default: {formatCurrency(rateCartItem.item.sales_price)}
            </p>
            <input
              type="text"
              inputMode="decimal"
              placeholder="Enter special rate…"
              value={rateValue}
              onChange={(e) => setRateValue(e.target.value)}
              autoFocus
              className="w-full h-12 px-4 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-primary)] font-mono placeholder:text-[var(--content-quaternary)] border-none outline-none focus:ring-1 focus:ring-[var(--border-subtle)]"
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setSpecialRate(rateCartItem.lineId, null);
                  setRateItemId(null);
                }}
                className="flex-1 h-12 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-secondary)] font-semibold hover:opacity-90"
              >
                Clear rate
              </button>
              <button
                onClick={handleSaveRate}
                className="flex-1 h-12 rounded-xl bg-[var(--bg-accent)] text-[var(--content-on-color)] font-semibold hover:opacity-90 active:scale-95"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        isOpen={!!deleteCartItem}
        onClose={() => setDeleteItemId(null)}
        title={deleteCartItem ? `Delete ${deleteCartItem.item.name}?` : ''}
      >
        {deleteCartItem && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--content-tertiary)]">
              This removes the line from the order. You can add it again from search if needed.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteItemId(null)}
                className="flex-1 h-12 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-secondary)] font-semibold hover:opacity-90"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  appHaptics.impactHeavy();
                  removeItem(deleteCartItem.lineId);
                  setDeleteItemId(null);
                }}
                className="flex-1 h-12 rounded-xl bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] font-semibold hover:opacity-90 active:scale-95"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
