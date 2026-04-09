import { useState, useEffect, useRef, useCallback, type ReactElement } from 'react';
import { ArrowLeft, Copy, Check, Warning, XCircle } from '@phosphor-icons/react';
import type { OrderItem } from '../../../types';
import type { ItemFlag } from '../../../hooks/useBillingFlow';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { formatCurrency, formatTimeAgo } from '../../../utils/formatters';

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
  const { copy, copiedId } = useCopyToClipboard();

  // --- Copy button state ---
  const [copyState, setCopyState] = useState<CopyState>('ready');

  // --- Table navigation ---
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [showHints, setShowHints] = useState(false);
  const hintsTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // --- Partial input ---
  const [partialInputRow, setPartialInputRow] = useState<number | null>(null);
  const [partialQty, setPartialQty] = useState('');
  const partialInputRef = useRef<HTMLInputElement>(null);

  // --- Finish confirmation ---
  const [showConfirm, setShowConfirm] = useState(false);

  // --- Number jump ---
  const [jumpBuffer, setJumpBuffer] = useState('');
  const jumpTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const flagCount = Object.keys(flags).length;

  // Scroll active row into view
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  useEffect(() => {
    if (activeRow !== null && rowRefs.current[activeRow]) {
      rowRefs.current[activeRow]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeRow]);

  // Auto-focus partial input
  useEffect(() => {
    if (partialInputRow !== null && partialInputRef.current) {
      setTimeout(() => partialInputRef.current?.focus(), 50);
    }
  }, [partialInputRow]);

  // Settle copy state after 1.5s
  useEffect(() => {
    if (copyState === 'copied') {
      const t = setTimeout(() => setCopyState('settled'), 1500);
      return () => clearTimeout(t);
    }
  }, [copyState]);

  // --- Copy all items ---
  const copyAllItems = useCallback(() => {
    const text = items.map(i => `${i.item_name}\t${i.qty_requested}`).join('\n');
    copy(text, 'all-items');
    setCopyState('copied');
  }, [items, copy]);

  // --- Show keyboard hints on first keypress, auto-hide after 10s ---
  const showHintsTemporarily = useCallback(() => {
    setShowHints(true);
    if (hintsTimeoutRef.current) clearTimeout(hintsTimeoutRef.current);
    hintsTimeoutRef.current = setTimeout(() => setShowHints(false), 10_000);
  }, []);

  // --- Handle finish ---
  const handleFinishAttempt = useCallback(() => {
    if (flagCount > 0) {
      setShowConfirm(true);
    } else {
      onFinish();
    }
  }, [flagCount, onFinish]);

  // --- Keyboard handler ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;

      // Allow partial input to handle its own keys
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Ctrl+Enter or Cmd+Enter = finish
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleFinishAttempt();
        return;
      }

      // Escape = close confirm modal or cancel partial
      if (e.key === 'Escape') {
        if (showConfirm) {
          e.preventDefault();
          setShowConfirm(false);
          return;
        }
        if (partialInputRow !== null) {
          e.preventDefault();
          setPartialInputRow(null);
          setPartialQty('');
          return;
        }
      }

      // Arrow navigation
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        showHintsTemporarily();
        setActiveRow(prev => {
          if (prev === null) return 0;
          return Math.min(prev + 1, items.length - 1);
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        showHintsTemporarily();
        setActiveRow(prev => {
          if (prev === null) return items.length - 1;
          return Math.max(prev - 1, 0);
        });
        return;
      }

      // Tab = jump to next unflagged row
      if (e.key === 'Tab' && !e.shiftKey && activeRow !== null) {
        e.preventDefault();
        for (let i = 1; i <= items.length; i++) {
          const idx = (activeRow + i) % items.length;
          if (!(idx in flags)) {
            setActiveRow(idx);
            break;
          }
        }
        return;
      }

      // F = flag no stock
      if ((e.key === 'f' || e.key === 'F') && activeRow !== null) {
        e.preventDefault();
        onFlagNoStock(activeRow);
        showHintsTemporarily();
        return;
      }

      // P = partial stock
      if ((e.key === 'p' || e.key === 'P') && activeRow !== null) {
        e.preventDefault();
        setPartialInputRow(activeRow);
        setPartialQty('');
        showHintsTemporarily();
        return;
      }

      // S = undo/clear flag
      if ((e.key === 's' || e.key === 'S') && activeRow !== null) {
        e.preventDefault();
        if (activeRow in flags) {
          onClearFlag(activeRow);
          showHintsTemporarily();
        }
        return;
      }

      // Number keys = jump to row
      if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        showHintsTemporarily();
        const newBuffer = jumpBuffer + e.key;
        setJumpBuffer(newBuffer);

        if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
        jumpTimeoutRef.current = setTimeout(() => {
          const rowNum = parseInt(newBuffer, 10);
          if (rowNum >= 1 && rowNum <= items.length) {
            setActiveRow(rowNum - 1);
          }
          setJumpBuffer('');
        }, 400);
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    items.length, activeRow, flags, partialInputRow, showConfirm, jumpBuffer,
    onFlagNoStock, onClearFlag, handleFinishAttempt, showHintsTemporarily,
  ]);

  // Clean up timeouts
  useEffect(() => {
    return () => {
      if (hintsTimeoutRef.current) clearTimeout(hintsTimeoutRef.current);
      if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
    };
  }, []);

  // --- Partial input confirm ---
  const confirmPartial = useCallback(() => {
    if (partialInputRow === null) return;
    const qty = parseInt(partialQty, 10);
    const maxQty = items[partialInputRow]?.qty_requested ?? 0;

    if (qty <= 0 || isNaN(qty)) {
      // Zero or invalid = no stock
      onFlagNoStock(partialInputRow);
    } else if (qty >= maxQty) {
      // Full qty available = clear flag
      onClearFlag(partialInputRow);
    } else {
      onFlagPartial(partialInputRow, qty);
    }
    setPartialInputRow(null);
    setPartialQty('');
  }, [partialInputRow, partialQty, items, onFlagNoStock, onFlagPartial, onClearFlag]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col animate-slide-up">

      {/* ── Top bar ── */}
      <div className="px-4 sm:px-6 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-opaque)] shrink-0">
        <button
          onClick={onSkip}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)] transition-colors px-2 py-1 -ml-2 rounded-lg hover:bg-[var(--bg-tertiary)]"
        >
          <ArrowLeft size={16} weight="bold" />
          Queue
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">

          {/* ── Header card ── */}
          <div className="ds-card p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 mb-1.5">
                  {priority === 'urgent' && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--bg-negative)] text-white text-xs font-bold uppercase tracking-wide shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                      Urgent
                    </span>
                  )}
                  <h1 className="text-2xl font-bold text-[var(--content-primary)] truncate">
                    {orderName}
                  </h1>
                </div>
                <p className="text-sm text-[var(--content-secondary)] font-medium">
                  {[city, salesperson, orderNumber].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-mono font-bold text-[var(--content-primary)]">
                  {formatCurrency(totalValue)}
                </p>
                <p className="text-xs text-[var(--content-tertiary)] mt-0.5">
                  {itemCount} items · {formatTimeAgo(createdAt)}
                </p>
              </div>
            </div>
          </div>

          {/* ── Copy CTA ── */}
          <button
            onClick={copyAllItems}
            disabled={isClaiming}
            className={`w-full transition-all active:scale-[0.98] rounded-2xl font-bold flex items-center justify-center gap-2.5 ${
              copyState === 'ready'
                ? 'h-14 bg-[var(--role-primary)] text-white text-base shadow-[0_4px_16px_rgba(37,99,235,0.2)] hover:opacity-90'
                : copyState === 'copied'
                  ? 'h-12 bg-[var(--bg-positive)] text-white text-base'
                  : 'h-12 bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] text-sm border border-[var(--border-positive)]'
            } ${isClaiming ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {copyState === 'ready' && (
              <>
                <Copy size={20} weight="bold" />
                Copy {items.length} items to clipboard
              </>
            )}
            {copyState === 'copied' && (
              <>
                <Check size={20} weight="bold" />
                Copied {items.length} items!
              </>
            )}
            {copyState === 'settled' && (
              <>
                <Check size={18} weight="bold" />
                Copied · Tap to re-copy
              </>
            )}
          </button>

          {/* ── Item table ── */}
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-opaque)] bg-[var(--bg-tertiary)]">
                  <th className="text-left text-xs font-bold text-[var(--content-tertiary)] uppercase tracking-wider px-4 py-3 w-10">#</th>
                  <th className="text-left text-xs font-bold text-[var(--content-tertiary)] uppercase tracking-wider px-4 py-3">Description</th>
                  <th className="text-left text-xs font-bold text-[var(--content-tertiary)] uppercase tracking-wider px-4 py-3 hidden sm:table-cell">Alias</th>
                  <th className="text-right text-xs font-bold text-[var(--content-tertiary)] uppercase tracking-wider px-4 py-3 w-16">Qty</th>
                  <th className="text-right text-xs font-bold text-[var(--content-tertiary)] uppercase tracking-wider px-4 py-3 w-36">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const flag = flags[index];
                  const isActive = activeRow === index;
                  const isPartialInput = partialInputRow === index;

                  let statusBg = '';
                  if (flag?.type === 'no_stock') statusBg = 'bg-[var(--bg-negative-subtle)]';
                  else if (flag?.type === 'partial') statusBg = 'bg-[var(--bg-warning-subtle)]';

                  return (
                    <tr
                      key={item.id}
                      ref={el => { rowRefs.current[index] = el; }}
                      onClick={() => {
                        setActiveRow(index);
                        showHintsTemporarily();
                      }}
                      className={`border-b border-[var(--border-faint)] last:border-b-0 cursor-pointer transition-colors ${statusBg} ${
                        isActive
                          ? 'border-l-[3px] border-l-[var(--role-primary)] bg-[var(--bg-secondary)]'
                          : 'hover:bg-[var(--bg-tertiary)]'
                      } ${flag ? '' : ''}`}
                    >
                      {/* Row number */}
                      <td className="px-4 py-3.5 text-sm font-mono text-[var(--content-tertiary)] tabular-nums">
                        {isActive && <span className="text-[var(--role-primary)] font-bold">▶</span>}
                        {!isActive && (index + 1)}
                      </td>

                      {/* Description */}
                      <td className="px-4 py-3.5">
                        <p className={`text-sm font-medium truncate max-w-[300px] ${
                          flag ? 'text-[var(--content-secondary)]' : 'text-[var(--content-primary)]'
                        }`}>
                          {item.item_name}
                        </p>
                        {/* Show alias inline on mobile */}
                        {item.item_alias && (
                          <p className="text-xs font-mono text-[var(--content-tertiary)] mt-0.5 sm:hidden">
                            {item.item_alias}
                          </p>
                        )}
                      </td>

                      {/* Alias (hidden on mobile) */}
                      <td className="px-4 py-3.5 hidden sm:table-cell">
                        <span className="text-xs font-mono text-[var(--content-tertiary)]">
                          {item.item_alias || '—'}
                        </span>
                      </td>

                      {/* Qty */}
                      <td className="px-4 py-3.5 text-right">
                        <span className="text-sm font-mono font-bold text-[var(--content-primary)] tabular-nums">
                          {item.qty_requested}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 text-right">
                        {isPartialInput ? (
                          <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
                            <span className="text-xs text-[var(--content-tertiary)]">Avail:</span>
                            <input
                              ref={partialInputRef}
                              type="number"
                              value={partialQty}
                              onChange={e => setPartialQty(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  confirmPartial();
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setPartialInputRow(null);
                                  setPartialQty('');
                                }
                              }}
                              placeholder={`/${item.qty_requested}`}
                              min={0}
                              max={item.qty_requested}
                              className="w-16 px-2 py-1 rounded-md border border-[var(--border-opaque)] bg-[var(--bg-primary)] text-sm font-mono text-[var(--content-primary)] text-right focus:border-[var(--role-primary)] focus:ring-1 focus:ring-[var(--role-primary)] outline-none"
                            />
                          </div>
                        ) : flag?.type === 'no_stock' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--content-negative)]">
                            <XCircle size={14} weight="fill" />
                            No Stock
                          </span>
                        ) : flag?.type === 'partial' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--content-warning)]">
                            <Warning size={14} weight="fill" />
                            {flag.availableQty} of {item.qty_requested}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Keyboard hints (progressive disclosure) ── */}
          {showHints && (
            <div className="text-center animate-slide-up">
              <p className="text-xs text-[var(--content-quaternary)]">
                <kbd className="font-mono bg-[var(--bg-secondary)] border border-[var(--border-opaque)] rounded px-1.5 py-0.5 text-[10px] shadow-sm mx-0.5">↑↓</kbd> Navigate
                <span className="mx-2 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)] rounded px-1.5 py-0.5 text-[10px] shadow-sm text-[var(--content-warning)] font-bold mx-0.5">F</kbd> No stock
                <span className="mx-2 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)] rounded px-1.5 py-0.5 text-[10px] shadow-sm text-[var(--content-warning)] font-bold mx-0.5">P</kbd> Partial
                <span className="mx-2 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-secondary)] border border-[var(--border-opaque)] rounded px-1.5 py-0.5 text-[10px] shadow-sm mx-0.5">S</kbd> Undo
                <span className="mx-2 text-[var(--border-opaque)]">·</span>
                <kbd className="font-mono bg-[var(--bg-secondary)] border border-[var(--border-opaque)] rounded px-1.5 py-0.5 text-[10px] shadow-sm mx-0.5">⌘↵</kbd> Finish
              </p>
            </div>
          )}

        </div>
      </div>

      {/* ── Sticky footer: Finish button ── */}
      <div className="shrink-0 border-t border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          {flagCount > 0 && (
            <p className="text-sm text-[var(--content-secondary)]">
              <span className="font-bold text-[var(--content-warning)]">{flagCount}</span> flagged
              <span className="text-[var(--content-quaternary)]"> · </span>
              <span className="text-[var(--content-positive)] font-medium">{items.length - flagCount} billed</span>
            </p>
          )}
          {flagCount === 0 && <div />}
          <button
            onClick={handleFinishAttempt}
            disabled={isApproving}
            className="h-12 px-8 rounded-xl bg-[var(--role-primary)] text-white text-base font-bold hover:opacity-90 active:scale-[0.98] transition-all shadow-sm disabled:opacity-50 flex items-center gap-2"
          >
            {isApproving ? 'Approving...' : 'Finish Billing'}
            {!isApproving && (
              <span className="text-xs font-normal opacity-70 hidden sm:inline">⌘↵</span>
            )}
          </button>
        </div>
      </div>

      {/* ── Confirmation overlay ── */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="bg-[var(--bg-secondary)] rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-xl animate-slide-up"
            role="dialog"
            aria-modal="true"
          >
            <h3 className="text-lg font-bold text-[var(--content-primary)] mb-4">
              Finish billing {orderName}?
            </h3>

            <div className="space-y-2 mb-6">
              {/* Billed items */}
              {items.length - flagCount > 0 && (
                <p className="text-sm text-[var(--content-positive)] font-medium">
                  ✅ {items.length - flagCount} item{items.length - flagCount !== 1 ? 's' : ''} billed normally
                </p>
              )}

              {/* Partial items */}
              {Object.entries(flags)
                .filter(([, f]) => f.type === 'partial')
                .map(([idx, f]) => {
                  const item = items[Number(idx)];
                  return (
                    <p key={idx} className="text-sm text-[var(--content-warning)]">
                      ⚠ {item?.item_name} — {f.availableQty} of {item?.qty_requested} billed, rest pending
                    </p>
                  );
                })}

              {/* No stock items */}
              {Object.entries(flags)
                .filter(([, f]) => f.type === 'no_stock')
                .map(([idx]) => {
                  const item = items[Number(idx)];
                  return (
                    <p key={idx} className="text-sm text-[var(--content-negative)]">
                      ✗ {item?.item_name} — no stock, {item?.qty_requested} pending
                    </p>
                  );
                })}
            </div>

            <p className="text-xs text-[var(--content-tertiary)] mb-6">
              Out of stock items will be marked pending. Partial items billed at available qty.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 h-12 rounded-xl border border-[var(--border-opaque)] text-sm font-bold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowConfirm(false);
                  onFinish();
                }}
                disabled={isApproving}
                className="flex-1 h-12 rounded-xl bg-[var(--role-primary)] text-white text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isApproving ? 'Approving...' : 'Confirm & Finish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
