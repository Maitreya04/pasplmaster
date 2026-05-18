import { useMemo, useState, useCallback, useEffect, useRef, type ReactElement } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase/client';
import type { Item, StockLocationCode } from '../../../types';
import { buildSearchIndex } from '../../../lib/search/searchIndex';
import { searchItems } from '../../../lib/search/itemSearch';
import { useItems } from '../../../hooks/useItems';
import { fetchLocationwiseAvailableForBusyCodes } from '../../../hooks/useBillingStockFreshness';
import { invalidateLocationwiseStockQueries } from '../../../hooks/useLocationwiseStock';
import { formatCurrency } from '../../../utils/formatters';
import { formatSupabaseUserMessage } from '../../../lib/supabase/formatUserMessage';

const ADD_BILLING_LINE_MESSAGES: Record<string, string> = {
  invalid_qty: 'Enter a valid quantity (at least 1).',
  claim_lost:
    'Billing claim is no longer active. Release this order if needed, then claim it again and retry.',
  order_not_found: 'Order could not be found.',
  order_not_submitted: 'This order is not in submitted status, so lines cannot be added from Live Queue.',
  unknown_item: 'That item is not in the catalog.',
  invalid_price: 'Enter a valid rate (0 or above).',
  submit_failed: 'Could not add this line due to a database error. Try again; if it persists, contact support.',
  add_failed: 'Could not add line.',
  locked_by_sales_edit:
    'Sales is editing this order from My Orders. Wait until they tap Done editing, then retry.',
};

type AddLineSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  orderId: number;
  stockLocationCode: StockLocationCode | string | null | undefined;
  claimId: number | null;
  userId: number | null;
  existingItems: Array<{ item_id: number; qty_requested: number; item_name: string }>;
  onAdded: (orderItemId: number) => void;
};

export function AddLineSheet({
  isOpen,
  onClose,
  orderId,
  stockLocationCode,
  claimId,
  userId,
  existingItems,
  onAdded,
}: AddLineSheetProps): ReactElement | null {
  const queryClient = useQueryClient();
  const { data: catalogItems = [] } = useItems();
  const searchIndex = useMemo(() => buildSearchIndex(catalogItems), [catalogItems]);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selected, setSelected] = useState<Item | null>(null);
  const [qtyStr, setQtyStr] = useState('1');
  const [rateStr, setRateStr] = useState('');
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [liveAvailMap, setLiveAvailMap] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => window.clearTimeout(t);
  }, [query]);

  const results = useMemo(() => {
    if (!debouncedQuery) return [];
    return searchItems(debouncedQuery, searchIndex).slice(0, 12);
  }, [debouncedQuery, searchIndex]);

  const busyCodesForPreview = useMemo(() => {
    const codes = results
      .map((r) => r.item.busy_code)
      .filter((c): c is number => c != null && Number.isFinite(Number(c)))
      .map((c) => Number(c));
    return [...new Set(codes)].sort((a, b) => a - b);
  }, [results]);

  useEffect(() => {
    if (!isOpen || busyCodesForPreview.length === 0) return;
    let cancelled = false;
    void fetchLocationwiseAvailableForBusyCodes(busyCodesForPreview, stockLocationCode ?? 'main_store').then(
      (m) => {
        if (!cancelled) setLiveAvailMap(m);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isOpen, busyCodesForPreview, stockLocationCode]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setDebouncedQuery('');
      setSelected(null);
      setQtyStr('1');
      setRateStr('');
      setRpcError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (selected) {
      setRateStr(String(selected.sales_price ?? 0));
    }
  }, [selected]);

  const existingHint = useCallback(
    (itemId: number) => {
      const hits = existingItems.filter((r) => r.item_id === itemId);
      if (hits.length === 0) return null;
      const totalQty = hits.reduce((s, h) => s + h.qty_requested, 0);
      return `${hits.length} line${hits.length === 1 ? '' : 's'} · ${totalQty} pcs`;
    },
    [existingItems],
  );

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !claimId || !userId) throw new Error('Missing selection or claim');
      const qty = parseInt(qtyStr, 10);
      if (!Number.isFinite(qty) || qty < 1) throw new Error('Enter a valid qty');
      const rate = parseFloat(rateStr.replace(',', ''));
      if (!Number.isFinite(rate) || rate < 0) throw new Error('Enter a valid rate');

      const { data, error } = await supabase.rpc('add_billing_line', {
        p_order_id: orderId,
        p_item_id: selected.id,
        p_qty: qty,
        p_price_quoted: rate,
        p_claim_id: claimId,
        p_user_id: userId,
      });

      if (error) throw error;
      const payload = data as {
        success?: boolean;
        error?: string | unknown;
        detail?: string;
        order_item_id?: number;
      } | null;
      if (!payload?.success) {
        const errField = payload?.error;
        const code =
          typeof errField === 'string'
            ? errField
            : errField != null
              ? JSON.stringify(errField)
              : 'add_failed';
        const base = ADD_BILLING_LINE_MESSAGES[code] ?? code;
        const detailField = payload?.detail;
        const detail =
          typeof detailField === 'string' && detailField.trim() ? detailField.trim() : '';
        throw new Error(detail ? `${base} (${detail})` : base);
      }
      return payload.order_item_id as number;
    },
    onSuccess: (orderItemId) => {
      void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-stock-freshness'] });
      void invalidateLocationwiseStockQueries(queryClient);
      onAdded(orderItemId);
      onClose();
    },
    onError: (err: unknown) => {
      setRpcError(formatSupabaseUserMessage(err));
    },
  });

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && !selected) {
      window.setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen, selected]);

  if (!isOpen) return null;

  const locLabel = stockLocationCode === 'jabalpur' ? 'Jabalpur' : 'Main Store';

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div
        className="ds-card w-full sm:max-w-lg max-h-[min(92vh,92dvh)] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-xl animate-slide-up overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-line-title"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)] shrink-0">
          <h2 id="add-line-title" className="text-base font-bold text-[var(--content-primary)]">
            Add line
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-[var(--bg-tertiary)] text-[var(--content-secondary)]"
            aria-label="Close"
          >
            <X size={22} weight="bold" />
          </button>
        </div>

        {!selected ? (
          <div className="flex-1 min-h-0 flex flex-col p-4 gap-3">
            <div className="relative">
              <MagnifyingGlass
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--content-quaternary)]"
                size={18}
              />
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search catalog · Live stock @ ${locLabel}`}
                className="ds-input w-full pl-10 pr-3 py-2.5 text-sm"
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1 pr-1">
              {debouncedQuery.length === 0 && (
                <p className="text-sm text-[var(--content-quaternary)] text-center py-8">
                  Type name or code to search.
                </p>
              )}
              {debouncedQuery.length > 0 && results.length === 0 && (
                <p className="text-sm text-[var(--content-secondary)] text-center py-8">No matches.</p>
              )}
              {results.map(({ item }) => {
                const bc = item.busy_code != null ? Number(item.busy_code) : null;
                const live =
                  bc != null && Number.isFinite(bc) ? liveAvailMap.get(bc) ?? null : null;
                const hint = existingHint(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelected(item)}
                    className="w-full text-left rounded-xl border border-[var(--border-subtle)] px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--content-primary)] line-clamp-2">
                          {item.name}
                        </p>
                        <p className="font-ds-label-size font-mono text-[var(--content-quaternary)] mt-0.5 truncate">
                          {[item.alias1, item.alias].filter(Boolean).join(' · ') || '—'} · Rack{' '}
                          {item.rack_no ?? '—'}
                        </p>
                        {hint && (
                          <p className="text-[11px] text-[var(--content-accent)] mt-1">
                            Already on order: {hint}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {live != null ? (
                          <span className="ds-chip ds-chip--sm bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border-[var(--border-accent)]">
                            Live {live}
                          </span>
                        ) : (
                          <span className="font-ds-label-size text-[var(--content-quaternary)]">—</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            <button
              type="button"
              className="text-sm font-medium text-[var(--role-primary)] hover:underline"
              onClick={() => {
                setSelected(null);
                setRpcError(null);
              }}
            >
              ← Back to search
            </button>
            <div>
              <p className="text-sm font-semibold text-[var(--content-primary)]">{selected.name}</p>
              <p className="font-ds-label-size font-mono text-[var(--content-quaternary)] mt-1">
                {[selected.alias1, selected.alias].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-ds-label-size text-[var(--content-secondary)]">Qty</span>
                <input
                  type="number"
                  min={1}
                  value={qtyStr}
                  onChange={(e) => setQtyStr(e.target.value)}
                  className="ds-input w-full mt-1 text-sm font-mono tabular-nums"
                />
              </label>
              <label className="block">
                <span className="font-ds-label-size text-[var(--content-secondary)]">Rate</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={rateStr}
                  onChange={(e) => setRateStr(e.target.value)}
                  className="ds-input w-full mt-1 text-sm font-mono tabular-nums"
                />
              </label>
            </div>

            <button
              type="button"
              className="text-xs font-medium text-[var(--role-primary)] hover:underline"
              onClick={() => setRateStr(String(selected.sales_price ?? 0))}
            >
              Reset to system rate ({formatCurrency(selected.sales_price ?? 0)})
            </button>

            {rpcError && (
              <p className="text-sm text-[var(--content-negative)] rounded-xl bg-[var(--bg-negative-subtle)] px-3 py-2 border border-[var(--border-negative)]">
                {rpcError}
              </p>
            )}

            <button
              type="button"
              disabled={addMutation.isPending || !claimId || !userId}
              onClick={() => {
                setRpcError(null);
                addMutation.mutate();
              }}
              className="w-full h-11 rounded-xl bg-[var(--role-primary)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {addMutation.isPending ? 'Adding…' : 'Add to order'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
