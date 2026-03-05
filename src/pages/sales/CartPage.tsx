import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, MagnifyingGlass, CheckCircle, Plus } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { useCustomers } from '../../hooks/useCustomers';
import { useTransports } from '../../hooks/useTransports';
import { supabase } from '../../lib/supabase/client';
import {
  PageHeader,
  NumberStepper,
  BigButton,
  SelectTrigger,
} from '../../components/shared';
import type { Customer } from '../../types';

import { formatCurrencyRaw as formatCurrency } from '../../utils/formatters';

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
                  className="w-full min-h-[48px] pl-9 pr-3 rounded-lg bg-[var(--bg-tertiary)] text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] text-base border-none outline-none focus:ring-1 focus:ring-[var(--border-subtle)]"
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
                    className="w-full text-left px-4 py-3 flex items-center justify-between gap-2 hover:bg-[var(--bg-tertiary)] transition-colors min-h-[48px]"
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

// ---------------------------------------------------------------------------
// CartPage
// ---------------------------------------------------------------------------
export default function CartPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    items,
    updateQty,
    removeItem,
    clearCart,
    totalCount,
    totalValue,
    selectedCustomer: customer,
    setSelectedCustomer: setCustomer,
    selectedTransport: transport,
    setSelectedTransport: setTransport,
    priority,
    setPriority,
    notes,
    setNotes,
  } = useCart();
  const { userName } = useAuth();
  const { data: transports = [] } = useTransports();

  const [submittedOrderNumber, setSubmittedOrderNumber] = useState<string | null>(null);
  const [showItemBreakdown, setShowItemBreakdown] = useState(false);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!customer || !userName) throw new Error('Customer and salesperson required');

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          customer_id: customer.id,
          customer_name: customer.name,
          customer_city: customer.city ?? null,
          transport_id: transport?.id ?? null,
          transport_name: transport?.name ?? null,
          salesperson_name: userName,
          status: 'submitted',
          priority,
          notes: notes.trim() || null,
          item_count: totalCount,
          total_value: totalValue,
        })
        .select('id, order_number')
        .single();

      if (orderError) throw orderError;
      if (!order) throw new Error('Order insert failed');

      const orderItems = items.map((ci) => {
        const price = ci.specialRate ?? ci.item.sales_price;
        return {
          order_id: order.id,
          item_id: ci.item.id,
          item_name: ci.item.name,
          item_alias: ci.item.alias,
          rack_no: ci.item.rack_no,
          qty_requested: ci.qty,
          price_quoted: price,
          price_system: ci.item.sales_price,
          state: 'pending',
        };
      });

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);

      if (itemsError) throw itemsError;

      return order.order_number;
    },
    onSuccess: (orderNumber) => {
      clearCart();
      setSubmittedOrderNumber(orderNumber);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const handleSubmit = () => submitMutation.mutate();

  // Success screen
  if (submittedOrderNumber) {
    return (
      <div className="min-h-screen flex flex-col">
        <PageHeader title="Order Submitted" onBack={() => navigate('/sales')} />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-20 h-20 rounded-full bg-[var(--bg-positive-subtle)] flex items-center justify-center mb-6">
            <CheckCircle size={40} weight="fill" className="text-[var(--content-positive)]" />
          </div>
          <h2 className="text-2xl font-bold text-[var(--content-primary)] mb-2">
            Order Submitted
          </h2>
          <p className="text-3xl font-bold font-mono text-[var(--content-accent)] mb-6">
            {submittedOrderNumber}
          </p>
          <div className="w-full max-w-sm space-y-3">
            <BigButton
              variant="primary"
              onClick={() => {
                setSubmittedOrderNumber(null);
                navigate('/sales/new');
              }}
            >
              Create Another
            </BigButton>
            <BigButton
              variant="secondary"
              onClick={() => {
                setSubmittedOrderNumber(null);
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

      <div className="p-4 flex-1 space-y-6">
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
            {/* Item list */}
            <section>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
                  {items.length} item{items.length !== 1 ? 's' : ''}
                </h2>
                <button
                  type="button"
                  onClick={() => navigate('/sales/new')}
                  className="flex items-center gap-1.5 min-h-[48px] px-3 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-accent)] font-semibold hover:bg-[var(--bg-accent-subtle)] transition-colors"
                >
                  <Plus size={18} weight="bold" />
                  Add More Items
                </button>
              </div>
              <ul className="space-y-2">
                {items.map((ci) => {
                  const price = ci.specialRate ?? ci.item.sales_price;
                  const partNo = ci.item.alias1 ?? ci.item.alias;
                  return (
                    <li
                      key={ci.item.id}
                      className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] min-h-[56px]"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-[var(--content-primary)] truncate">
                          {ci.item.name}
                        </p>
                        {partNo && (
                          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[var(--content-tertiary)] font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded">
                            <span>{partNo}</span>
                          </p>
                        )}
                        <p className="text-sm text-[var(--content-tertiary)] mt-0.5">
                          {formatCurrency(price)} / pc
                        </p>
                      </div>
                      <div className="shrink-0">
                        <NumberStepper
                          value={ci.qty}
                          onChange={(q) => updateQty(ci.item.id, q)}
                          min={1}
                          presets={[]}
                        />
                      </div>
                      <button
                        onClick={() => removeItem(ci.item.id)}
                        className="shrink-0 w-10 h-10 flex items-center justify-center rounded-lg text-[var(--content-tertiary)] hover:bg-[var(--bg-negative-subtle)] hover:text-[var(--content-negative)] transition-colors min-h-[48px] min-w-[48px]"
                        aria-label="Remove item"
                      >
                        <X size={20} weight="bold" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Customer */}
            <section>
              <label className="block text-sm font-semibold text-[var(--content-secondary)] mb-2">
                Customer
              </label>
              <SearchableCustomerDropdown
                value={customer}
                onChange={setCustomer}
              />
            </section>

            {/* Transport */}
            <section>
              <label className="block text-sm font-semibold text-[var(--content-secondary)] mb-2">
                Transport
              </label>
              <select
                value={transport?.id ?? ''}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setTransport(id ? transports.find((t) => t.id === id) ?? null : null);
                }}
                className="w-full h-14 px-4 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-primary)] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--border-subtle)]"
              >
                <option value="">Select Transport</option>
                {transports.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </section>

            {/* Priority */}
            <section>
              <label className="block text-sm font-semibold text-[var(--content-secondary)] mb-2">
                Priority
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPriority('normal')}
                  className={`flex-1 h-12 rounded-xl font-semibold transition-colors ${
                    priority === 'normal'
                      ? 'bg-[var(--bg-tertiary)] text-[var(--content-primary)] border-2 border-[var(--border-subtle)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--content-tertiary)] border-2 border-transparent'
                  }`}
                >
                  Normal
                </button>
                <button
                  type="button"
                  onClick={() => setPriority('urgent')}
                  className={`flex-1 h-12 rounded-xl font-semibold transition-colors ${
                    priority === 'urgent'
                      ? 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] border-2 border-[var(--content-negative)] animate-pulse'
                      : 'bg-[var(--bg-secondary)] text-[var(--content-tertiary)] border-2 border-transparent'
                  }`}
                >
                  URGENT
                </button>
              </div>
            </section>

            {/* Notes */}
            <section>
              <label className="block text-sm font-semibold text-[var(--content-secondary)] mb-2">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Special instructions for billing…"
                rows={3}
                className="w-full px-4 py-3 rounded-xl bg-[var(--bg-tertiary)] text-[var(--content-primary)] placeholder:text-[var(--content-quaternary)] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--border-subtle)] resize-none"
              />
            </section>

            {/* Summary */}
            <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] space-y-2">
              <div className="flex justify-between items-baseline text-sm text-[var(--content-secondary)]">
                <div>
                  <span>Items</span>
                  <span className="ml-1 text-[var(--content-tertiary)]">
                    ({totalCount} pcs)
                  </span>
                </div>
                <span className="font-mono text-[var(--content-primary)]">
                  {formatCurrency(totalValue)}
                </span>
              </div>
              <div className="flex justify-between items-baseline text-sm text-[var(--content-secondary)]">
                <div>
                  <span>Transport</span>
                  <p className="text-[11px] text-[var(--content-tertiary)]">
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
                  {formatCurrency(totalValue)}
                </span>
              </div>
              <button
                type="button"
                className="mt-2 w-full flex items-center justify-between text-xs text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
                onClick={() => setShowItemBreakdown((prev) => !prev)}
              >
                <span>{showItemBreakdown ? 'Hide item-wise calculation' : 'Show item-wise calculation'}</span>
                <span className="text-[10px]">
                  {showItemBreakdown ? '▲' : '▼'}
                </span>
              </button>
              {showItemBreakdown && (
                <div className="mt-1 pt-2 border-t border-dashed border-[var(--border-subtle)] space-y-1.5">
                  {items.map((ci) => {
                    const price = ci.specialRate ?? ci.item.sales_price;
                    const lineTotal = price * ci.qty;
                    const partNo = ci.item.alias1 ?? ci.item.alias;
                    return (
                      <div key={ci.item.id} className="flex justify-between gap-3 text-[11px] text-[var(--content-secondary)]">
                        <div className="min-w-0">
                          <p className="truncate">
                            {ci.item.name}
                          </p>
                          {partNo && (
                            <p className="font-mono text-[10px] text-[var(--content-tertiary)] truncate">
                              {partNo}
                            </p>
                          )}
                        </div>
                        <div className="text-right font-mono">
                          <p>
                            {formatCurrency(price)} × {ci.qty}
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

            {/* Submit */}
            <BigButton
              variant="primary"
              onClick={handleSubmit}
              loading={submitMutation.isPending}
              disabled={!customer}
            >
              Submit Order
            </BigButton>
          </>
        )}
      </div>
    </div>
  );
}
