import { ArrowLeft, CaretLeft, CaretRight, Check, MagnifyingGlass, Package, PencilSimple, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { filterCatalog, itemStatusComplete } from './helpers';
import type { OcrStageItem, OcrStageProduct } from './types';

export function OcrLabEditDrawer({
  item,
  itemIndex,
  totalItems,
  catalog,
  onClose,
  onConfirm,
  onNavigate,
}: {
  item: OcrStageItem;
  itemIndex: number;
  totalItems: number;
  catalog: OcrStageProduct[];
  onClose: () => void;
  onConfirm: (product: OcrStageProduct | null, quantity: number) => void;
  onNavigate: (direction: 'prev' | 'next') => void;
}): React.JSX.Element {
  const [isSearching, setIsSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<OcrStageProduct | null>(item.matchedProduct);
  const [quantity, setQuantity] = useState(item.quantity);

  useEffect(() => {
    setSelectedProduct(item.matchedProduct);
    setQuantity(item.quantity);
    setIsSearching(false);
    setQuery('');
  }, [item.id, item.matchedProduct, item.quantity]);

  const filtered = useMemo(() => filterCatalog(catalog, query), [catalog, query]);

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute bottom-0 left-0 right-0 z-50 flex max-h-[85%] flex-col rounded-t-[1.75rem] border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex justify-center pb-1 pt-3">
          <div className="h-1.5 w-12 rounded-full bg-[var(--border-opaque)]" />
        </div>

        {!isSearching ? (
          <div className="relative flex flex-col overflow-y-auto p-5">
            <div className="mb-4 flex items-center justify-between">
              <button onClick={() => onNavigate('prev')} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--content-secondary)]">
                <CaretLeft size={20} />
              </button>
              <div className="flex-1 text-center">
                <p className="text-sm font-bold text-[var(--content-primary)]">Item {itemIndex + 1} of {totalItems}</p>
                <p className="mt-0.5 text-xs text-[var(--content-tertiary)]">
                  {itemStatusComplete(item.status)
                    ? <span className="font-medium text-[var(--content-positive)]">Confirmed</span>
                    : <>Confidence <span className="font-semibold text-[var(--content-primary)]">{Math.round(item.confidence * 100)}%</span></>}
                </p>
              </div>
              <button onClick={() => onNavigate('next')} className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--content-secondary)]">
                <CaretRight size={20} />
              </button>
            </div>

            <button onClick={onClose} className="absolute right-4 top-4 rounded-full bg-[var(--bg-tertiary)] p-2 text-[var(--content-tertiary)]">
              <X size={16} />
            </button>

            <div className="mb-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-[0.18em] text-[var(--content-tertiary)]">Original extraction</p>
              <p className="text-lg font-semibold text-[var(--content-primary)]">{item.rawText}</p>
              <p className="mt-2 text-xs text-[var(--content-tertiary)]">{item.source.match_explanation}</p>
            </div>

            <div className="mb-5">
              <div className="mb-2 flex items-end justify-between">
                <p className="text-sm font-semibold text-[var(--content-secondary)]">Matched Product</p>
                <button onClick={() => setIsSearching(true)} className="flex items-center gap-1 text-sm font-medium text-[var(--role-primary)]">
                  <MagnifyingGlass size={14} />
                  <span>Change</span>
                </button>
              </div>

              {selectedProduct ? (
                <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--role-primary-subtle)] p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                    <Package size={20} className="text-[var(--role-primary)]" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-[var(--content-primary)]">{selectedProduct.name}</p>
                    <p className="text-xs text-[var(--content-tertiary)]">
                      SKU: {selectedProduct.sku} {selectedProduct.secondaryCode ? `• Alt ${selectedProduct.secondaryCode}` : ''} • ₹{selectedProduct.price}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-xl border border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] p-4">
                  <p className="text-sm font-medium text-[var(--content-negative)]">No exact catalog match selected</p>
                  <button onClick={() => setIsSearching(true)} className="rounded-lg border border-[var(--border-negative)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs font-semibold text-[var(--content-negative)]">
                    Search Catalog
                  </button>
                </div>
              )}
            </div>

            <div className="mb-6">
              <p className="mb-2 text-sm font-semibold text-[var(--content-secondary)]">Quantity</p>
              <div className="flex items-center gap-4">
                <div className="flex items-center overflow-hidden rounded-xl border border-[var(--border-opaque)]">
                  <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="bg-[var(--bg-primary)] px-4 py-2 text-lg font-bold text-[var(--content-secondary)]">-</button>
                  <div className="min-w-12 px-4 py-2 text-center font-semibold text-[var(--content-primary)]">{quantity}</div>
                  <button onClick={() => setQuantity(quantity + 1)} className="bg-[var(--bg-primary)] px-4 py-2 text-lg font-bold text-[var(--content-secondary)]">+</button>
                </div>
                <div className="text-sm text-[var(--content-tertiary)]">
                  Total <span className="font-bold text-[var(--content-primary)]">₹{(selectedProduct?.price ?? 0) * quantity}</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                onConfirm(selectedProduct, quantity);
                onNavigate('next');
              }}
              disabled={!selectedProduct}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--role-primary)] py-3.5 font-semibold text-[var(--content-on-color)] disabled:opacity-50"
            >
              <Check size={18} />
              <span>Confirm & Next</span>
            </button>
          </div>
        ) : (
          <div className="flex h-[60vh] flex-col">
            <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] p-4">
              <button onClick={() => setIsSearching(false)} className="-ml-2 rounded-full p-2 text-[var(--content-secondary)]">
                <ArrowLeft size={20} />
              </button>
              <div className="relative flex-1">
                <MagnifyingGlass size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--content-tertiary)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search parts by name or SKU…"
                  className="h-11 w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-primary)] pl-10 pr-4 text-sm text-[var(--content-primary)] outline-none ring-[var(--role-primary)] focus:ring-2"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {filtered.map((product) => (
                <button
                  key={product.id}
                  onClick={() => {
                    setSelectedProduct(product);
                    setIsSearching(false);
                  }}
                  className="flex w-full items-center justify-between rounded-xl border-b border-[var(--border-subtle)] p-3 text-left hover:bg-[var(--bg-primary)]"
                >
                  <div>
                    <p className="font-medium text-[var(--content-primary)]">{product.name}</p>
                    <p className="text-xs text-[var(--content-tertiary)]">{product.sku}</p>
                  </div>
                  <div className="flex items-center gap-3 text-[var(--content-secondary)]">
                    <span className="text-sm font-semibold">₹{product.price}</span>
                    <PencilSimple size={16} />
                  </div>
                </button>
              ))}
              {filtered.length === 0 ? (
                <div className="py-10 text-center text-sm text-[var(--content-tertiary)]">No products found</div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
