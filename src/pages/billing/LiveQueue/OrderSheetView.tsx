import { useState, useEffect, useRef, useCallback, type ReactElement } from 'react';
import { ArrowLeft, Copy, Check, Warning, XCircle } from '@phosphor-icons/react';
import type { OrderItem } from '../../../types';
import type { ItemFlag } from '../../../hooks/useBillingFlow';
import { StatusBadge } from '../../../components/shared';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { getBookPrice, getQuotedPrice, isSpecialRateItem, summarizeSpecialPricing } from '../../../lib/specialPricing';
import {
  formatCurrency,
  formatTimeAgo,
  orderItemDisplayName,
  orderItemProductCode,
} from '../../../utils/formatters';

/** UI labels for billing (Windows-first). Finish still works with Cmd+Enter on Mac. */
const SHORTCUT_COPY_ALL = 'Alt+C';
const SHORTCUT_FINISH = 'Ctrl+Enter';

interface OrderSheetViewProps {
  orderName: string;
  orderNumber: string;
  salesperson: string | null;
  customerAddress: string | null;
  notes: string | null;
  city: string | null;
  itemCount: number;
  totalValue: number;
  priority: string;
  createdAt: string;
  items: OrderItem[];
  flags: Record<number, ItemFlag>;
  isClaiming: boolean;
  isApproving: boolean;
  isRejecting: boolean;
  onFlagNoStock: (itemIndex: number) => void;
  onFlagPartial: (itemIndex: number, availableQty: number) => void;
  onClearFlag: (itemIndex: number) => void;
  onFinish: () => void;
  onReject: (reason: string) => void;
  onSkip: () => void;
}

type CopyState = 'ready' | 'copied' | 'settled';

export function OrderSheetView({
  orderName,
  orderNumber,
  salesperson,
  customerAddress,
  notes,
  city,
  itemCount,
  totalValue,
  priority,
  createdAt,
  items,
  flags,
  isClaiming,
  isApproving,
  isRejecting,
  onFlagNoStock,
  onFlagPartial,
  onClearFlag,
  onFinish,
  onReject,
  onSkip,
}: OrderSheetViewProps): ReactElement {
  const { copy } = useCopyToClipboard();
  const headerMeta = [orderNumber, salesperson].filter(Boolean).join(' · ');
  const customerLocation = [city, customerAddress?.trim()].filter(Boolean).join(' · ');
  const trimmedNotes = notes?.trim() ?? '';

  const [copyState, setCopyState] = useState<CopyState>('ready');
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [showHints, setShowHints] = useState(false);
  const hintsTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [partialInputRow, setPartialInputRow] = useState<number | null>(null);
  const [partialQty, setPartialQty] = useState('');
  const partialInputRef = useRef<HTMLInputElement>(null);

  const [showConfirm, setShowConfirm] = useState(false);
  const confirmFinishRef = useRef<HTMLButtonElement>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const [jumpBuffer, setJumpBuffer] = useState('');
  const jumpTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flagCount = Object.keys(flags).length;
  const { specialLineCount, specialQty } = summarizeSpecialPricing(items);

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
      .map((i) => `${orderItemDisplayName(i)}\t${i.qty_requested}`)
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

      // Use `code` so Mac Option+C works (Option sets altKey; `key` may be "ç" not "c").
      if (e.altKey && e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (!isClaiming && items.length > 0) {
          copyAllItems();
          showHintsTemporarily();
        }
        return;
      }

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
        if (showReject) {
          e.preventDefault();
          if (!isRejecting) {
            setShowReject(false);
            setRejectReason('');
          }
          return;
        }
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
    items.length, activeRow, flags, partialInputRow, showConfirm, showReject, jumpBuffer,
    onFlagNoStock, onClearFlag, handleFinishAttempt, confirmFinish, showHintsTemporarily,
    copyAllItems, isClaiming, isRejecting,
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

  const handleRejectConfirm = useCallback(() => {
    const trimmedReason = rejectReason.trim();
    if (!trimmedReason || isRejecting) return;
    onReject(trimmedReason);
  }, [rejectReason, isRejecting, onReject]);

  return (
    <div className="density-compact min-h-screen bg-[var(--bg-primary)] flex flex-col animate-slide-up">

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
                {headerMeta && (
                  <p className="text-xs text-[var(--content-tertiary)]">
                    {headerMeta}
                  </p>
                )}
                {customerLocation && (
                  <p className="mt-1 text-sm text-[var(--content-tertiary)] line-clamp-2">
                    <span className="font-medium text-[var(--content-secondary)]">
                      {city}
                    </span>
                    {city && customerAddress?.trim() && (
                      <span className="px-1 text-[var(--content-quaternary)]">·</span>
                    )}
                    {customerAddress?.trim() && (
                      <span>{customerAddress.trim()}</span>
                    )}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-base font-mono font-semibold text-[var(--content-primary)] tabular-nums">
                  {formatCurrency(totalValue)}
                </p>
                <p className="font-ds-label-size text-[var(--content-quaternary)] mt-0.5">
                  {itemCount} items · {formatTimeAgo(createdAt)}
                </p>
              </div>
            </div>
            {specialLineCount > 0 && (
              <div className="mt-4 rounded-2xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 py-3">
                <p className="text-sm font-semibold text-[var(--content-warning)]">
                  Special-rate order on {specialLineCount} line{specialLineCount === 1 ? '' : 's'}
                  {specialQty > 0 ? ` · ${specialQty} pcs` : ''}.
                </p>
                <p className="mt-1 text-xs text-[var(--content-warning)]">
                  Busy may default to book price after paste. Use the highlighted quoted rate shown on each line while billing.
                </p>
              </div>
            )}
            {trimmedNotes && (
              <div className="mt-4 rounded-2xl border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--content-accent)]">
                  Sales note for billing
                </p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-[var(--content-primary)]">
                  {trimmedNotes}
                </p>
              </div>
            )}
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
                <span className="font-ds-label-size font-normal opacity-60 hidden sm:inline mx-1">·</span>
                <span className="font-ds-label-size font-normal opacity-80 hidden sm:inline tabular-nums">
                  {SHORTCUT_COPY_ALL}
                </span>
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
            <table className="ds-table w-full table-fixed">
              <thead>
                <tr>
                  <th className="w-10 text-center">#</th>
                  <th className="min-w-0">Item</th>
                  <th className="hidden sm:table-cell w-[10.5rem] max-w-[10.5rem] lg:w-[13rem] lg:max-w-[13rem] align-top">
                    Code
                  </th>
                  <th className="text-right w-24">Rate</th>
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
                  const hasSpecialRate = isSpecialRateItem(item);
                  const quotedPrice = getQuotedPrice(item);
                  const bookPrice = getBookPrice(item);

                  let rowBg = '';
                  if (flag?.type === 'no_stock') rowBg = 'bg-[var(--bg-negative-subtle)]';
                  else if (flag?.type === 'partial') rowBg = 'bg-[var(--bg-warning-subtle)]';
                  else if (hasSpecialRate) rowBg = 'bg-[var(--bg-warning-subtle)]';

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
                      <td className="text-center tabular-nums align-top">
                        {isActive ? (
                          <span className="text-[var(--role-primary)] font-bold text-xs">&#9654;</span>
                        ) : (
                          <span className="text-[var(--content-quaternary)] text-xs font-mono">{index + 1}</span>
                        )}
                      </td>

                      {/* Item name — multi-line wrap; min-w-0 required for wrapping in table-fixed */}
                      <td className="min-w-0 align-top">
                        <p
                          className={`text-sm font-medium leading-snug whitespace-normal break-words [overflow-wrap:anywhere] ${
                            flag ? 'text-[var(--content-secondary)]' : 'text-[var(--content-primary)]'
                          }`}
                        >
                          {orderItemDisplayName(item)}
                        </p>
                        {productCode && (
                          <div className="mt-1 sm:hidden max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
                            <span
                              className="inline-block font-ds-label-size font-mono text-[var(--content-quaternary)] whitespace-nowrap"
                              title={productCode}
                            >
                              {productCode}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Product code — always one line; long codes scroll inside capped column */}
                      <td className="hidden sm:table-cell align-top min-w-0 w-[10.5rem] max-w-[10.5rem] lg:w-[13rem] lg:max-w-[13rem]">
                        <div
                          className="max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]"
                          title={productCode || undefined}
                        >
                          <span className="inline-block font-ds-label-size font-mono text-[var(--content-quaternary)] whitespace-nowrap pr-1">
                            {productCode || '—'}
                          </span>
                        </div>
                      </td>

                      <td className="text-right align-top">
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-sm font-mono font-semibold tabular-nums ${
                            hasSpecialRate ? 'text-[var(--content-warning)]' : 'text-[var(--content-primary)]'
                          }`}>
                            {formatCurrency(quotedPrice)}
                          </span>
                          {hasSpecialRate && bookPrice != null && (
                            <>
                              <span className="ds-chip ds-chip--warning ds-chip--sm">Special</span>
                              <span className="text-[11px] text-[var(--content-quaternary)]">
                                Book {formatCurrency(bookPrice)}
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Qty */}
                      <td className="text-right align-top">
                        <span className="text-sm font-mono font-semibold text-[var(--content-primary)] tabular-nums">
                          {item.qty_requested}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="text-right align-top">
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
              <p className="font-ds-label-size text-[var(--content-quaternary)]">
                <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">↑↓</kbd> Navigate
                <span className="mx-1.5 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)] rounded px-1.5 py-0.5 font-ds-micro text-[var(--content-warning)] font-semibold mx-0.5">F</kbd> No stock
                <span className="mx-1.5 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)] rounded px-1.5 py-0.5 font-ds-micro text-[var(--content-warning)] font-semibold mx-0.5">P</kbd> Partial
                <span className="mx-1.5 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">S</kbd> Undo
                <span className="mx-1.5 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">{SHORTCUT_COPY_ALL}</kbd> Copy lines
                <span className="mx-1.5 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">{SHORTCUT_FINISH}</kbd> Finish
              </p>
            </div>
          )}

        </div>
      </div>

      {/* Sticky footer */}
      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 lg:px-6 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          {flagCount > 0 ? (
            <p className="text-xs text-[var(--content-secondary)]">
              <span className="font-semibold text-[var(--content-warning)]">{flagCount}</span> flagged
              <span className="text-[var(--content-quaternary)]"> · </span>
              <span className="text-[var(--content-positive)] font-medium">{items.length - flagCount} billed</span>
            </p>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowReject(true)}
              disabled={isApproving || isRejecting}
              className="h-11 px-4 rounded-xl border border-[var(--border-negative)] text-[var(--content-negative)] text-sm font-semibold hover:bg-[var(--bg-negative-subtle)] transition-all disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={handleFinishAttempt}
              disabled={isApproving || isRejecting}
              className="h-11 px-6 rounded-xl bg-[var(--role-primary)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              {isApproving ? 'Approving...' : 'Finish Billing'}
              {!isApproving && (
                <>
                  <span className="font-ds-label-size font-normal opacity-60 hidden sm:inline mx-1">·</span>
                  <span className="font-ds-label-size font-normal opacity-70 hidden sm:inline tabular-nums">{SHORTCUT_FINISH}</span>
                </>
              )}
            </button>
          </div>
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

            <p className="font-ds-label-size text-[var(--content-quaternary)] mb-4">
              Out of stock items will be marked pending. Partial items billed at available qty.
            </p>

            <p className="font-ds-label-size text-[var(--content-quaternary)] mb-5 text-center sm:text-left">
              <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">{SHORTCUT_FINISH}</kbd>
              <span className="text-[var(--content-quaternary)]"> confirm</span>
              <span className="mx-1.5 text-[var(--border-opaque)]">·</span>
              <kbd className="font-mono bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 font-ds-micro mx-0.5">Esc</kbd>
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
                  <span className="font-ds-label-size font-normal opacity-80 hidden sm:inline tabular-nums">{SHORTCUT_FINISH}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject overlay */}
      {showReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="ds-card p-6 max-w-md w-full shadow-xl animate-slide-up"
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-base font-bold text-[var(--content-primary)] mb-2">
              Reject {orderName}?
            </h3>
            <p className="text-sm text-[var(--content-secondary)] mb-4">
              Enter a reason. Sales will be notified with this message.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Pricing mismatch, customer requested change..."
              className="w-full h-28 px-3 py-2 rounded-xl border border-[var(--border-opaque)] text-sm text-[var(--content-primary)] bg-[var(--bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--role-primary)]"
              autoFocus
            />
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowReject(false);
                  setRejectReason('');
                }}
                disabled={isRejecting}
                className="flex-1 h-11 rounded-xl border border-[var(--border-opaque)] text-sm font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRejectConfirm}
                disabled={isRejecting || !rejectReason.trim()}
                className="flex-1 h-11 rounded-xl bg-[var(--bg-negative)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isRejecting ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
