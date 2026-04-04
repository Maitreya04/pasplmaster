import { useState, useMemo, useRef, useCallback, useEffect, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MagnifyingGlass,
  CheckCircle,
  Plus,
  CurrencyInr,
  Trash,
  Copy,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useCustomers } from '../../hooks/useCustomers';
import { useTransports } from '../../hooks/useTransports';
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
import { splitCartLine } from '../../lib/cartSupply';
import {
  buildOrderCustomerMessage,
  whatsappPrefilledUrl,
} from '../../lib/buildOrderCustomerMessage';

// ---------------------------------------------------------------------------
// SearchableCustomerDropdown
// ---------------------------------------------------------------------------
interface SearchableCustomerDropdownProps {
  value: Customer | null;
  onChange: (c: Customer | null) => void;
  placeholder?: string;
}

function SearchableCustomerDropdown({
  value,
  onChange,
  placeholder = 'Select Customer',
}: SearchableCustomerDropdownProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const { data: customers = [], isLoading } = useCustomers();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers.slice(0, 30);
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.city?.toLowerCase().includes(q) ?? false),
    ).slice(0, 30);
  }, [customers, query]);

  return (
    <div className="relative">
      <SelectTrigger
        onClick={() => setOpen(!open)}
        open={open}
        placeholder={placeholder}
        hasValue={!!value}
      >
        {value && (
          <>
            {value.name}
            {value.city && (
              <span className="text-[var(--content-tertiary)] font-normal ml-1">
                · {value.city}
              </span>
            )}
          </>
        )}
      </SelectTrigger>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] shadow-xl overflow-hidden">
            <div className="p-2 border-b border-[var(--border-subtle)]">
              <div className="relative">
                <MagnifyingGlass
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--content-tertiary)]"
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name or city…"
                  className="w-full min-h-12 pl-9 pr-3 rounded-lg bg-[var(--bg-tertiary)] text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] text-base border-none outline-none focus:ring-1 focus:ring-[var(--border-subtle)]"
                  autoFocus
                />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto">
              {isLoading ? (
                <p className="p-4 text-sm text-[var(--content-tertiary)]">
                  Loading…
                </p>
              ) : filtered.length === 0 ? (
                <p className="p-4 text-sm text-[var(--content-tertiary)]">
                  No customers found
                </p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onChange(c);
                      setOpen(false);
                      setQuery('');
                    }}
                    className="w-full text-left px-4 py-3 flex items-center justify-between gap-2 hover:bg-[var(--bg-tertiary)] transition-colors min-h-12"
                  >
                    <span className="text-[var(--content-primary)] truncate">
                      {c.name}
                      {c.city && (
                        <span className="text-[var(--content-tertiary)] font-normal ml-1">
                          · {c.city}
                        </span>
                      )}
                    </span>
                    {value?.id === c.id && (
                      <CheckCircle size={18} weight="fill" className="text-[var(--content-positive)] shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
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
    <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--bg-accent-subtle)] px-3 py-1.5 text-[12px] font-semibold leading-none text-[var(--content-accent)]">
      Special rate
    </span>
  );
}

// ---------------------------------------------------------------------------
// BillingItemCard — shows items that ship from stock. Qty is read-only
// (determined by stock). Swipe for rate / delete.
// ---------------------------------------------------------------------------
interface BillingItemCardProps {
  item: CartItem;
  shipQty: number;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onRatePress: (item: CartItem) => void;
  onDeletePress: (item: CartItem) => void;
  previewOnMount?: boolean;
}

const BillingItemCard = memo(function BillingItemCard({
  item: cartItem,
  shipQty,
  isOpen,
  onOpenChange,
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
  const lineTotal = price * shipQty;

  return (
    <li className="relative overflow-hidden rounded-2xl">
      <div className="absolute inset-y-0 right-0 flex">
        <button
          type="button"
          onClick={() => onRatePress(cartItem)}
          className="flex w-20 flex-col items-center justify-center gap-1 bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]"
          aria-label={`Set special rate for ${cartItem.item.name}`}
        >
          <CurrencyInr size={20} weight="bold" />
          <span className="text-xs font-semibold">Rate</span>
        </button>
        <button
          type="button"
          onClick={() => onDeletePress(cartItem)}
          className="flex w-20 flex-col items-center justify-center gap-1 bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]"
          aria-label={`Delete ${cartItem.item.name}`}
        >
          <Trash size={20} weight="bold" />
          <span className="text-xs font-semibold">Delete</span>
        </button>
      </div>

      <div
        className={`relative rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 ${isDragging ? '' : 'transition-transform duration-180 ease-out'}`}
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
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {partNo && (
                <p className="inline-flex max-w-full items-center truncate rounded-full bg-[var(--bg-tertiary)] px-3 py-1.5 font-mono text-[12px] font-semibold tracking-[0.04em] text-[var(--content-primary)]">
                  {partNo}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="font-mono text-[15px] font-semibold leading-none text-[var(--content-primary)]">
                {formatCurrency(price)}
              </p>
            </div>
          </div>

          <p className="mt-2 text-[15px] font-semibold leading-[1.35] text-[var(--content-primary)] whitespace-normal break-words line-clamp-2">
            {cartItem.item.name}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {hasSpecialRate && <SpecialRateChip />}
            {hasSpecialRate && (
              <span className="font-mono text-[10px] text-[var(--content-tertiary)] line-through">
                {formatCurrency(cartItem.item.sales_price)}
              </span>
            )}
          </div>

          <div className="mt-3.5 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--content-tertiary)]">
                Line total
              </p>
              <p className="mt-1 font-mono text-[15px] font-semibold text-[var(--content-secondary)]">
                {formatCurrency(lineTotal)}
              </p>
            </div>
            <div className="shrink-0 flex flex-col items-end">
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--content-tertiary)] mb-1">
                Qty
              </p>
              <p className="font-mono text-xl font-bold text-[var(--content-primary)] tabular-nums">
                {shipQty}
              </p>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
});

// ---------------------------------------------------------------------------
// PurchaseOrderCard — editable stepper for PO qty. For PO-only items, also
// serves as the only card (with delete).
// ---------------------------------------------------------------------------
const PurchaseOrderCard = memo(function PurchaseOrderCard({
  cartItem,
  poQty,
  shipQty,
  onChangePoQty,
  onRemoveLine,
}: {
  cartItem: CartItem;
  poQty: number;
  shipQty: number;
  onChangePoQty: (lineId: string, newPoQty: number) => void;
  onRemoveLine: (lineId: string) => void;
}) {
  const partNo = cartItem.item.alias1 ?? cartItem.item.alias;
  const fullyPo = shipQty === 0;

  return (
    <li className="rounded-2xl border border-[color-mix(in_srgb,var(--border-warning)_42%,var(--border-subtle))] bg-[var(--bg-warning-subtle)] px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {partNo && (
            <span className="inline-flex max-w-full shrink-0 items-center truncate rounded-full border border-[color-mix(in_srgb,var(--content-primary)_12%,var(--border-subtle))] bg-[var(--bg-secondary)] px-3 py-1 font-mono text-[11px] font-semibold tracking-[0.04em] text-[var(--content-primary)]">
              {partNo}
            </span>
          )}
          <p className="mt-1.5 text-[14px] font-semibold leading-[1.35] text-[var(--content-primary)] line-clamp-2 break-words">
            {cartItem.item.name}
          </p>
        </div>
        <div className="shrink-0">
          <NumberStepper
            value={poQty}
            onChange={(q) => onChangePoQty(cartItem.lineId, q)}
            min={fullyPo ? 1 : 0}
            presets={[]}
            variant="compact"
            showRemoveAtMin={fullyPo}
            onRemove={fullyPo ? () => onRemoveLine(cartItem.lineId) : undefined}
          />
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
  const queryClient = useQueryClient();
  const {
    items,
    updateQty,
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
  const { userName } = useAuth();
  const { data: transports = [] } = useTransports();

  const [submitSuccess, setSubmitSuccess] = useState<{
    orderNumber: string;
    shareText: string;
  } | null>(null);
  const [showItemBreakdown, setShowItemBreakdown] = useState(false);
  const [openActionsItemId, setOpenActionsItemId] = useState<string | null>(null);
  const [rateItemId, setRateItemId] = useState<string | null>(null);
  const [rateValue, setRateValue] = useState('');
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);

  const rateCartItem = rateItemId !== null ? items.find((ci) => ci.lineId === rateItemId) ?? null : null;
  const deleteCartItem = deleteItemId !== null ? items.find((ci) => ci.lineId === deleteItemId) ?? null : null;

  /** Single pass over lines: splits, billing/PO lists, totals (one stock calc per line). */
  const {
    billingSplits,
    poSplits,
    billingCount,
    billingTotal,
    poPiecesTotal,
  } = useMemo(() => {
    const billingSplits: { ci: CartItem; ship: number; po: number }[] = [];
    const poSplits: { ci: CartItem; ship: number; po: number }[] = [];
    let billingCount = 0;
    let billingTotal = 0;
    let poPiecesTotal = 0;
    for (const ci of items) {
      const { ship, po } = splitCartLine(ci.item, ci.qty);
      if (ship > 0) billingSplits.push({ ci, ship, po });
      if (po > 0) poSplits.push({ ci, ship, po });
      billingCount += ship;
      billingTotal += (ci.specialRate ?? ci.item.sales_price) * ship;
      poPiecesTotal += po;
    }
    return {
      billingSplits,
      poSplits,
      billingCount,
      billingTotal,
      poPiecesTotal,
    };
  }, [items]);

  /** When PO stepper changes, adjust total qty; ship from stock stays implied by item + stock. */
  const handlePoQtyChange = useCallback(
    (lineId: string, newPoQty: number) => {
      const ci = items.find((c) => c.lineId === lineId);
      if (!ci) return;
      const { ship } = splitCartLine(ci.item, ci.qty);
      const newTotal = ship + Math.max(0, newPoQty);
      if (newTotal < 1) {
        removeItem(lineId);
      } else {
        updateQty(lineId, newTotal);
      }
    },
    [items, updateQty, removeItem],
  );

  const openRateSheet = useCallback((cartItem: CartItem) => {
    setOpenActionsItemId(null);
    setRateItemId(cartItem.lineId);
    setRateValue(cartItem.specialRate !== null ? String(cartItem.specialRate) : '');
  }, []);

  const handleSaveRate = useCallback(() => {
    if (!rateCartItem) return;
    const parsed = parseFloat(rateValue.replace(/,/g, ''));
    setSpecialRate(rateCartItem.lineId, Number.isNaN(parsed) || parsed < 0 ? null : parsed);
    setRateItemId(null);
  }, [rateCartItem, rateValue, setSpecialRate]);

  const openDeleteSheet = useCallback((cartItem: CartItem) => {
    setOpenActionsItemId(null);
    setDeleteItemId(cartItem.lineId);
  }, []);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!customer || !userName) throw new Error('Customer and salesperson required');

      const submittedAt = new Date();

      const linesForMessage = items.map((ci) => {
        const { ship, po } = splitCartLine(ci.item, ci.qty);
        return {
          name: ci.item.name,
          qtyRequested: ci.qty,
          qtyShip: ship,
          qtyPo: po,
        };
      });

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          customer_id: customer.id,
          customer_name: customer.name,
          customer_city: customer.city ?? null,
          transport_id: transport?.id ?? null,
          transport_name: transport?.name ?? null,
          salesperson_name: userName,
          workflow_status: 'submitted',
          priority,
          notes: notes.trim() || null,
          item_count: billingCount,
          total_value: billingTotal,
        })
        .select('id, order_number')
        .single();

      if (orderError) throw orderError;
      if (!order) throw new Error('Order insert failed');

      const orderNumber = order.order_number;
      const envBiz = import.meta.env.VITE_BUSINESS_DISPLAY_NAME;
      const businessName =
        typeof envBiz === 'string' && envBiz.trim() !== '' ? envBiz.trim() : undefined;

      const shareTextFinal = buildOrderCustomerMessage({
        customerName: customer.name,
        date: submittedAt,
        lines: linesForMessage,
        businessName,
      });

      const orderItems = items.map((ci) => {
        const price = ci.specialRate ?? ci.item.sales_price;
        const { ship, po } = splitCartLine(ci.item, ci.qty);
        return {
          order_id: order.id,
          item_id: ci.item.id,
          item_name: ci.item.name,
          item_alias: ci.item.alias,
          rack_no: ci.item.rack_no,
          qty_requested: ci.qty,
          qty_shippable: ship,
          qty_po: po,
          qty_approved: ship,
          price_quoted: price,
          price_system: ci.item.sales_price,
          state: 'pending',
        };
      });

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);

      if (itemsError) throw itemsError;

      return {
        orderNumber,
        shareText: shareTextFinal,
      };
    },
    onSuccess: (payload) => {
      clearCart();
      setSubmitSuccess(payload);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const handleSubmit = () => submitMutation.mutate();

  // Success screen
  if (submitSuccess) {
    const waUrl = whatsappPrefilledUrl(submitSuccess.shareText);

    return (
      <div className="min-h-screen flex flex-col">
        <PageHeader
          title="Order Submitted"
          onBack={() => {
            setSubmitSuccess(null);
            navigate('/sales');
          }}
        />
        <div className="flex-1 flex flex-col p-6 pb-10">
          <div className="flex flex-col items-center text-center shrink-0">
            <div className="w-20 h-20 rounded-full bg-[var(--bg-positive-subtle)] flex items-center justify-center mb-6">
              <CheckCircle size={40} weight="fill" className="text-[var(--content-positive)]" />
            </div>
            <h2 className="text-2xl font-bold text-[var(--content-primary)] mb-2">
              Order Submitted
            </h2>
            <p className="text-3xl font-bold font-mono text-[var(--content-accent)] mb-4">
              {submitSuccess.orderNumber}
            </p>
            <p className="text-sm text-[var(--content-tertiary)] max-w-md mb-4">
              Share the summary below with your customer (billed vs pending as of submit time). WhatsApp
              opens with the text ready — choose the party in WhatsApp and send.
            </p>
          </div>

          <div className="w-full max-w-lg mx-auto flex-1 min-h-0 flex flex-col gap-3">
            <pre className="text-left text-[13px] leading-relaxed text-[var(--content-secondary)] whitespace-pre-wrap break-words rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 max-h-[40vh] overflow-y-auto">
              {submitSuccess.shareText}
            </pre>
            <div className="flex flex-col sm:flex-row gap-2">
              <BigButton
                variant="secondary"
                className="flex-1"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(submitSuccess.shareText);
                    toast.success('Summary copied');
                  } catch {
                    toast.error('Could not copy');
                  }
                }}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <Copy size={20} weight="bold" />
                  Copy summary
                </span>
              </BigButton>
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-h-14 flex items-center justify-center gap-2 rounded-2xl font-semibold bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border border-[var(--border-subtle)]"
              >
                <WhatsappLogo size={22} weight="fill" />
                WhatsApp
              </a>
            </div>
          </div>

          <div className="w-full max-w-sm mx-auto space-y-3 mt-6">
            <BigButton
              variant="primary"
              onClick={() => {
                setSubmitSuccess(null);
                navigate('/sales/new');
              }}
            >
              Create Another
            </BigButton>
            <BigButton
              variant="secondary"
              onClick={() => {
                setSubmitSuccess(null);
                navigate('/sales/orders');
              }}
            >
              My Orders
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
        onBack={() => navigate('/sales/new')}
      />

      <div className={`flex-1 space-y-6 p-4 ${items.length > 0 ? 'pb-48' : ''}`}>
        {items.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[var(--content-tertiary)] mb-4">
              Cart is empty. Add items from New Order.
            </p>
            <BigButton variant="secondary" onClick={() => navigate('/sales/new')}>
              Add Items
            </BigButton>
          </div>
        ) : (
          <>
            {/* Billing items — what ships from stock */}
            {billingSplits.length > 0 && (
              <section>
                <div className="mb-3 flex items-center justify-between gap-3 px-1">
                  <h2 className="text-base font-semibold text-[var(--content-primary)]">
                    Items
                  </h2>
                  <p className="text-sm text-[var(--content-tertiary)]">
                    {billingSplits.length} line{billingSplits.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <ul className="space-y-2">
                  {billingSplits.map((row) => (
                    <BillingItemCard
                      key={row.ci.lineId}
                      item={row.ci}
                      shipQty={row.ship}
                      isOpen={openActionsItemId === row.ci.lineId}
                      onOpenChange={(open) => setOpenActionsItemId(open ? row.ci.lineId : null)}
                      onRatePress={openRateSheet}
                      onDeletePress={openDeleteSheet}
                      previewOnMount={row === billingSplits[0]}
                    />
                  ))}
                </ul>
              </section>
            )}

            {/* Purchase order — editable qty */}
            {poSplits.length > 0 && (
              <section>
                <div className="mb-3 flex items-center justify-between gap-3 px-1">
                  <h2 className="text-base font-semibold text-[var(--content-warning)]">Purchase order</h2>
                  <p className="text-sm text-[var(--content-tertiary)]">
                    {poSplits.length} line{poSplits.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <ul className="space-y-2">
                  {poSplits.map((row) => (
                    <PurchaseOrderCard
                      key={row.ci.lineId}
                      cartItem={row.ci}
                      poQty={row.po}
                      shipQty={row.ship}
                      onChangePoQty={handlePoQtyChange}
                      onRemoveLine={removeItem}
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
                <select
                  value={transport?.id ?? ''}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : null;
                    setTransport(id ? transports.find((t) => t.id === id) ?? null : null);
                  }}
                  className="h-14 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 text-[var(--content-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--border-subtle)]"
                >
                  <option value="">Select Transport</option>
                  {transports.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
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
                <span className="font-mono text-[var(--content-primary)]">
                  {formatCurrency(0)}
                </span>
              </div>
              <div className="border-t border-[var(--border-subtle)] pt-3 mt-2 flex justify-between text-base font-semibold text-[var(--content-primary)]">
                <span>Grand Total</span>
                <span className="font-mono">
                  {formatCurrency(billingTotal)}
                </span>
              </div>
              <button
                type="button"
                className="mt-2 w-full flex items-center justify-between text-xs text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
                onClick={() => setShowItemBreakdown((prev) => !prev)}
              >
                <span>{showItemBreakdown ? 'Hide item-wise calculation' : 'Show item-wise calculation'}</span>
                <span className="text-xs">
                  {showItemBreakdown ? '▲' : '▼'}
                </span>
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
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <button
                type="button"
                onClick={() => navigate('/sales/new')}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 font-semibold text-[var(--content-primary)] transition-colors hover:bg-[var(--bg-tertiary)]"
              >
                <Plus size={18} weight="bold" />
                Add items
              </button>
              <BigButton
                variant="primary"
                onClick={handleSubmit}
                loading={submitMutation.isPending}
                disabled={!customer}
              >
                Submit Order
              </BigButton>
            </div>
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
