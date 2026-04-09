import { useState, useEffect, useRef, useCallback, type ReactElement } from 'react';
import { ArrowLeft, Copy, Check, Warning, XCircle } from '@phosphor-icons/react';
import type { OrderItem } from '../../../types';
import type { ItemFlag } from '../../../hooks/useBillingFlow';
import { StatusBadge } from '../../../components/shared';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import {
  formatCurrency,
  formatTimeAgo,
  orderItemDisplayName,
  orderItemProductCode,
} from '../../../utils/formatters';

interface OrderSheetViewProps {
  orderName: string;
  orderNumber: string;
  salesperson: string | null;
  city: string | null;
  itemCount: number;
  totalValue: number;
  priority: string;
  createdAt: string;
  items: OrderItem[];
  flags: Record<number, ItemFlag>;
  isClaiming: boolean;
  isApproving: boolean;
  onFlagNoStock: (itemIndex: number) => void;
  onFlagPartial: (itemIndex: number, availableQty: number) => void;
  onClearFlag: (itemIndex: number) => void;
  onFinish: () => void;
  onSkip: () => void;
}

type CopyState = 'ready' | 'copied' | 'settled';

export function OrderSheetView({
  orderName,
  orderNumber,
  salesperson,
  city,
  itemCount,
  totalValue,
  priority,
  createdAt,
  items,
  flags,
  isClaiming,
  isApproving,
  onFlagNoStock,
  onFlagPartial,
  onClearFlag,
  onFinish,
  onSkip,
}: OrderSheetViewProps): ReactElement {
  const { copy } = useCopyToClipboard();

  const [copyState, setCopyState] = useState<CopyState>('ready');
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [showHints, setShowHints] = useState(false);
  const hintsTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [partialInputRow, setPartialInputRow] = useState<number | null>(null);
  const [partialQty, setPartialQty] = useState('');
  const partialInputRef = useRef<HTMLInputElement>(null);

  const [showConfirm, setShowConfirm] = useState(false);
  const confirmFinishRef = useRef<HTMLButtonElement>(null);

  const [jumpBuffer, setJumpBuffer] = useState('');
  const jumpTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flagCount = Object.keys(flags).length;

  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  useEffect(() => {
    if (activeRow !== null && rowRefs.current[activeRow]) {
      rowRefs.current[activeRow]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeRow]);

  useEffect(() => {
    if (partialInputRow !== null && partialInputRef.current) {
      setTimeout(() => partialInputRef.current?.focus(), 50);
    }
  }, [partialInputRow]);

  useEffect(() => {
    if (copyState === 'copied') {
      const t = setTimeout(() => setCopyState('settled'), 1500);
      return () => clearTimeout(t);
    }
  }, [copyState]);

  const copyAllItems = useCallback(() => {
    const text = items
      .map((i) => {
        const code = orderItemProductCode(i);
        return `${code || i.item_name}\t${i.qty_requested}`;
      })
      .join('\n');
    copy(text, 'all-items');
    setCopyState('copied');
  }, [items, copy]);

  const showHintsTemporarily = useCallback(() => {
    setShowHints(true);
    if (hintsTimeoutRef.current) clearTimeout(hintsTimeoutRef.current);
    hintsTimeoutRef.current = setTimeout(() => setShowHints(false), 10_000);
  }, []);

  const handleFinishAttempt = useCallback(() => {
    if (flagCount > 0) {
      setShowConfirm(true);
    } else {
      onFinish();
    }
  }, [flagCount, onFinish]);

  const confirmFinish = useCallback(() => {
    if (isApproving) return;
    setShowConfirm(false);
    onFinish();
  }, [isApproving, onFinish]);

  useEffect(() => {
    if (!showConfirm) return;
    const id = window.setTimeout(() => confirmFinishRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [showConfirm]);

  // Keyboard handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (showConfirm) {
          confirmFinish();
        } else {
          handleFinishAttempt();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (showConfirm) { e.preventDefault(); setShowConfirm(false); return; }
        if (partialInputRow !== null) { e.preventDefault(); setPartialInputRow(null); setPartialQty(''); return; }
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        showHintsTemporarily();
        setActiveRow(prev => prev === null ? 0 : Math.min(prev + 1, items.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        showHintsTemporarily();
        setActiveRow(prev => prev === null ? items.length - 1 : Math.max(prev - 1, 0));
        return;
      }

      if (e.key === 'Tab' && !e.shiftKey && activeRow !== null) {
        e.preventDefault();
        for (let i = 1; i <= items.length; i++) {
          const idx = (activeRow + i) % items.length;
          if (!(idx in flags)) { setActiveRow(idx); break; }
        }
        return;
      }

      if ((e.key === 'f' || e.key === 'F') && activeRow !== null) {
        e.preventDefault(); onFlagNoStock(activeRow); showHintsTemporarily(); return;
      }
      if ((e.key === 'p' || e.key === 'P') && activeRow !== null) {
        e.preventDefault(); setPartialInputRow(activeRow); setPartialQty(''); showHintsTemporarily(); return;
      }
      if ((e.key === 's' || e.key === 'S') && activeRow !== null) {
        e.preventDefault();
        if (activeRow in flags) { onClearFlag(activeRow); showHintsTemporarily(); }
        return;
      }

      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        showHintsTemporarily();
        const newBuffer = jumpBuffer + e.key;
        setJumpBuffer(newBuffer);
        if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
        jumpTimeoutRef.current = setTimeout(() => {
          const rowNum = parseInt(newBuffer, 10);
          if (rowNum >= 1 && rowNum <= items.length) setActiveRow(rowNum - 1);
          setJumpBuffer('');
        }, 400);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    items.length, activeRow, flags, partialInputRow, showConfirm, jumpBuffer,
    onFlagNoStock, onClearFlag, handleFinishAttempt, confirmFinish, showHintsTemporarily,
  ]);

  useEffect(() => {
    return () => {
      if (hintsTimeoutRef.current) clearTimeout(hintsTimeoutRef.current);
      if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
    };
  }, []);

  const confirmPartial = useCallback(() => {
    if (partialInputRow === null) return;
    const qty = parseInt(partialQty, 10);
    const maxQty = items[partialInputRow]?.qty_requested ?? 0;
    if (qty <= 0 || isNaN(qty)) {
      onFlagNoStock(partialInputRow);
    } else if (qty >= maxQty) {
      onClearFlag(partialInputRow);
    } else {
      onFlagPartial(partialInputRow, qty);
    }
    setPartialInputRow(null);
    setPartialQty('');
  }, [partialInputRow, partialQty, items, onFlagNoStock, onFlagPartial, onClearFlag]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col animate-slide-up">

      {/* Top bar */}
      <div className="px-4 lg:px-6 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] shrink-0">
        <button
          onClick={onSkip}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--content-secondary)] hover:text-[var(--content-primary)] transition-colors px-2 py-1 -ml-2 rounded-lg hover:bg-[var(--bg-tertiary)]"
        >
          <ArrowLeft size={16} weight="bold" />
          Queue
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 lg:px-6 py-6 space-y-4">

          {/* Header card */}
          <div className="ds-card p-4 lg:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {priority === 'urgent' && <StatusBadge status="urgent" />}
                  <h1 className="text-xl font-bold text-[var(--content-primary)] truncate">
                    {orderName}
                  </h1>
                </div>
                <p className="text-xs text-[var(--content-tertiary)]">
                  {[orderNumber, city, salesperson].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-base font-mono font-semibold text-[var(--content-primary)] tabular-nums">
                  {formatCurrency(totalValue)}
                </p>
                <p className="text-[11px] text-[var(--content-quaternary)] mt-0.5">
                  {itemCount} items · {formatTimeAgo(createdAt)}
                </p>
              </div>
            </div>
          </div>

          {/* Copy CTA */}
          <button
            onClick={copyAllItems}
            disabled={isClaiming}
            className={`w-full transition-all active:scale-[0.98] rounded-xl font-semibold flex items-center justify-center gap-2 ${
              copyState === 'ready'
                ? 'h-12 bg-[var(--role-primary)] text-white text-sm shadow-sm hover:opacity-90'
                : copyState === 'copied'
                  ? 'h-11 bg-[var(--bg-positive)] text-white text-sm'
                  : 'h-11 bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] text-xs border border-[var(--border-positive)]'
            } ${isClaiming ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {copyState === 'ready' && (
              <>
                <Copy size={18} weight="bold" />
                Copy {items.length} items to clipboard
              </>
            )}
            {copyState === 'copied' && (
              <>
                <Check size={18} weight="bold" />
                Copied {items.length} items!
              </>
            )}
            {copyState === 'settled' && (
              <>
                <Check size={16} weight="bold" />
                Copied · Tap to re-copy
              </>
            )}
          </button>

          {/* Item table — DS classes */}
          <div className="ds-card overflow-hidden">
            <table className="ds-table">
              <thead>
                <tr>
                  <th className="w-10 text-center">#</th>
                  <th>Item</th>
                  <th className="hidden sm:table-cell">Code</th>
                  <th className="text-right w-14">Qty</th>
                  <th className="text-right w-32">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const flag = flags[index];
                  const isActive = activeRow === index;
                  const isPartialInput = partialInputRow === index;
                  const productCode = orderItemProductCode(item);

                  let rowBg = '';
                  if (flag?.type === 'no_stock') rowBg = 'bg-[var(--bg-negative-subtle)]';
                  else if (flag?.type === 'partial') rowBg = 'bg-[var(--bg-warning-subtle)]';

                  return (
                    <tr
                      key={item.id}
                      ref={el => { rowRefs.current[index] = el; }}
                      onClick={() => { setActiveRow(index); showHintsTemporarily(); }}
                      className={`cursor-pointer ${rowBg} ${
                        isActive ? 'ds-row--selected' : ''
                      }`}
                    >
                      {/* Row number */}
                      <td className="text-center tabular-nums">
                        {isActive ? (
                          <span className="text-[var(--role-primary)] font-bold text-xs">&#9654;</span>
                        ) : (
                          <span className="text-[var(--content-quaternary)] text-xs font-mono">{index + 1}</span>
                        )}
                      </td>

                      {/* Item name — wrap fully; never ellipsis-truncate */}
                      <td className="min-w-0 max-w-none align-top">
                        <p
                          className={`text-sm font-medium whitespace-normal break-words [overflow-wrap:anywhere] ${
                            flag ? 'text-[var(--content-secondary)]' : 'text-[var(--content-primary)]'
                          }`}
                        >
                          {orderItemDisplayName(item)}
                        </p>
                        {productCode && (
                          <p className="text-[11px] font-mono text-[var(--content-quaternary)] mt-0.5 sm:hidden">
                            {productCode}
                          </p>
                        )}
                      </td>

                      {/* Product code — same as New Order search (alias 1 → alias) */}
                      <td className="hidden sm:table-cell">
                        <span className="text-[11px] font-mono text-[var(--content-quaternary)]">
                          {productCode || '—'}
                        </span>
                      </td>

                      {/* Qty */}
                      <td className="text-right">
                        <span className="text-sm font-mono font-semibold text-[var(--content-primary)] tabular-nums">
                          {item.qty_requested}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="text-right">
                        {isPartialInput ? (
                          <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                            <input
                              ref={partialInputRef}
                              type="number"
                              value={partialQty}
                              onChange={e => setPartialQty(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmPartial(); }
                                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPartialInputRow(null); setPartialQty(''); }
                              }}
                              placeholder={`/${item.qty_requested}`}
                              min={0}
                              max={item.qty_requested}
                              className="ds-input w-16 text-right text-sm font-mono py-1 px-2"
                            />
                          </div>
                        ) : flag?.type === 'no_stock' ? (
                          <span className="ds-chip ds-chip--negative ds-chip--sm">
                            <XCircle size={12} weight="fill" />
                            No Stock
                          </span>
                        ) : flag?.type === 'partial' ? (
                          <span className="ds-chip ds-chip--warning ds-chip--sm">
                            <Warning size={12} weight="fill" />
                            {flag.availableQty}/{item.qty_requested}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Keyboard hints — progressive disclosure */}
          {showHints && (
            <div className="text-center animate-slide-up">
              <p className="text-[11px] text-[var(--content-quaternary)]">
                <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-[10px] mx-0.5">↑↓</kbd> Navigate
                <span className="mx-1.5 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)] rounded px-1.5 py-0.5 text-[10px] text-[var(--content-warning)] font-semibold mx-0.5">F</kbd> No stock
                <span className="mx-1.5 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)] rounded px-1.5 py-0.5 text-[10px] text-[var(--content-warning)] font-semibold mx-0.5">P</kbd> Partial
                <span className="mx-1.5 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-[10px] mx-0.5">S</kbd> Undo
                <span className="mx-1.5 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-[10px] mx-0.5">⌘↵</kbd> Finish
              </p>
            </div>
          )}

        </div>
      </div>

      {/* Sticky footer */}
      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 lg:px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          {flagCount > 0 ? (
            <p className="text-xs text-[var(--content-secondary)]">
              <span className="font-semibold text-[var(--content-warning)]">{flagCount}</span> flagged
              <span className="text-[var(--content-quaternary)]"> · </span>
              <span className="text-[var(--content-positive)] font-medium">{items.length - flagCount} billed</span>
            </p>
          ) : (
            <div />
          )}
          <button
            onClick={handleFinishAttempt}
            disabled={isApproving}
            className="h-11 px-6 rounded-xl bg-[var(--role-primary)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all shadow-sm disabled:opacity-50 flex items-center gap-2"
          >
            {isApproving ? 'Approving...' : 'Finish Billing'}
            {!isApproving && (
              <span className="text-[11px] font-normal opacity-70 hidden sm:inline">⌘↵</span>
            )}
          </button>
        </div>
      </div>

      {/* Confirmation overlay */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="ds-card p-6 max-w-md w-full shadow-xl animate-slide-up"
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-base font-bold text-[var(--content-primary)] mb-4">
              Finish billing {orderName}?
            </h3>

            <div className="space-y-2 mb-5">
              {items.length - flagCount > 0 && (
                <p className="text-sm text-[var(--content-positive)] font-medium">
                  {items.length - flagCount} item{items.length - flagCount !== 1 ? 's' : ''} billed normally
                </p>
              )}
              {Object.entries(flags)
                .filter(([, f]) => f.type === 'partial')
                .map(([idx, f]) => {
                  const item = items[Number(idx)];
                  return (
                    <p key={idx} className="text-sm text-[var(--content-warning)]">
                      {item ? orderItemDisplayName(item) : ''} — {f.availableQty} of {item?.qty_requested}, rest pending
                    </p>
                  );
                })}
              {Object.entries(flags)
                .filter(([, f]) => f.type === 'no_stock')
                .map(([idx]) => {
                  const item = items[Number(idx)];
                  return (
                    <p key={idx} className="text-sm text-[var(--content-negative)]">
                      {item ? orderItemDisplayName(item) : ''} — no stock, {item?.qty_requested} pending
                    </p>
                  );
                })}
            </div>

            <p className="text-[11px] text-[var(--content-quaternary)] mb-4">
              Out of stock items will be marked pending. Partial items billed at available qty.
            </p>

            <p className="text-[11px] text-[var(--content-quaternary)] mb-5 text-center sm:text-left">
              <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-[10px] mx-0.5">⌘↵</kbd>
              <span className="text-[var(--content-quaternary)]"> confirm</span>
              <span className="mx-1.5 text-[var(--border-opaque)]">·</span>
              <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-[10px] mx-0.5">Esc</kbd>
              <span className="text-[var(--content-quaternary)]"> cancel</span>
            </p>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="flex-1 h-11 rounded-xl border border-[var(--border-opaque)] text-sm font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                Cancel
              </button>
              <button
                ref={confirmFinishRef}
                type="button"
                onClick={confirmFinish}
                disabled={isApproving}
                className="flex-1 h-11 rounded-xl bg-[var(--role-primary)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isApproving ? 'Approving...' : 'Confirm & Finish'}
                {!isApproving && (
                  <span className="text-[11px] font-normal opacity-80 hidden sm:inline">⌘↵</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
