import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Copy, Check, CheckCircle, Warning, XCircle } from '@phosphor-icons/react';
import type { OrderItem } from '../../../types';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { getBookPrice, getQuotedPrice, isSpecialRateItem } from '../../../lib/specialPricing';
import { formatCurrency } from '../../../utils/formatters';
import type { ManualFlagType, ManualFlag } from '../../../hooks/useBillingFlowMachine';

interface ProcessViewProps {
  orderName: string;
  items: OrderItem[];
  activeIndex: number;
  isSubmitting?: boolean;
  manualFlags: Record<number, ManualFlag>;
  onAdvance: () => void;
  onJump: (index: number) => void;
  onFlag: (itemIndex: number, type: ManualFlagType, availableQty: number) => void;
  onUnflag: (itemIndex: number) => void;
  onFinish: () => void;
}

export function ProcessView({ orderName, items, activeIndex, isSubmitting, manualFlags, onAdvance, onJump, onFlag, onUnflag: _onUnflag, onFinish }: ProcessViewProps): ReactElement {
  const { copy, copiedId } = useCopyToClipboard();
  const isComplete = activeIndex >= items.length;
  
  const activeItem = isComplete ? null : items[activeIndex];
  const activeQuotedPrice = activeItem ? getQuotedPrice(activeItem) : null;
  const activeBookPrice = activeItem ? getBookPrice(activeItem) : null;
  const activeHasSpecialRate = activeItem ? isSpecialRateItem(activeItem) : false;
  const previousItems = items.slice(0, activeIndex).reverse();
  const flagCount = Object.keys(manualFlags).length;
  
  // Inline flag mode toggle
  const [showFlagPanel, setShowFlagPanel] = useState(false);
  const [partialQty, setPartialQty] = useState('');
  const partialInputRef = useRef<HTMLInputElement>(null);
  
  // Reset flag panel when active item changes
  useEffect(() => {
    setShowFlagPanel(false);
    setPartialQty('');
  }, [activeIndex]);

  // Auto-focus partial input when panel opens
  useEffect(() => {
    if (showFlagPanel && partialInputRef.current) {
      // Small delay to let the panel animate in
      setTimeout(() => partialInputRef.current?.focus(), 100);
    }
  }, [showFlagPanel]);
  
  // Track direction for animations
  const prevIndexRef = useRef(activeIndex);
  const direction = activeIndex >= prevIndexRef.current ? 'forward' : 'backward';
  useEffect(() => {
    prevIndexRef.current = activeIndex;
  }, [activeIndex]);

  // Keyboard bindings & debounce
  const lastEnter = useRef(0);
  
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept when typing
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      if (e.key === 'Enter') {
        const now = Date.now();
        if (now - lastEnter.current < 400) return; // 400ms debounce
        lastEnter.current = now;

        e.preventDefault();
        
        if (e.shiftKey) {
           onJump(activeIndex - 1);
           return;
        }

        if (isComplete) {
          onFinish();
        } else if (activeItem) {
          const textToCopy = activeItem.item_alias || activeItem.item_name;
          copy(textToCopy, `act-code-${activeItem.id}`);
          onAdvance();
        }
      }

      // F = instant no-stock flag (one keystroke)
      if ((e.key === 'f' || e.key === 'F') && !isComplete && activeItem) {
        e.preventDefault();
        onFlag(activeIndex, 'no_stock', 0);
      }

      // P = open partial stock panel
      if ((e.key === 'p' || e.key === 'P') && !isComplete && activeItem) {
        e.preventDefault();
        setShowFlagPanel(true);
      }

      // Escape = close flag panel
      if (e.key === 'Escape' && showFlagPanel) {
        e.preventDefault();
        setShowFlagPanel(false);
      }
    };
    
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isComplete, activeItem, copy, onAdvance, onFinish, onJump, activeIndex, onFlag, showFlagPanel]);

  return (
    <div className="density-compact min-h-screen bg-[var(--bg-primary)] flex flex-col">
      {/* Mini header */}
      <div className="px-6 py-4 bg-[var(--bg-secondary)] border-b border-[var(--border-opaque)] shadow-sm shrink-0 flex items-center justify-between">
        <h2 className="text-lg font-bold text-[var(--content-primary)] truncate">{orderName}</h2>
        <div className="text-sm font-mono text-[var(--content-secondary)] bg-[var(--bg-tertiary)] px-3 py-1 rounded-full border border-[var(--border-subtle)]">
          {Math.min(activeIndex + 1, items.length)} / {items.length}
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        
        {/* Left: Active Item Focus Area */}
        <div className="flex-1 flex flex-col justify-center p-6 lg:p-12 relative">
          {!isComplete && activeItem ? (
            <div key={activeItem.id} className={`max-w-2xl w-full mx-auto ${direction === 'forward' ? 'animate-slide-in-right' : 'animate-slide-out-left'} opacity-0 [animation-fill-mode:forwards]`}>
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm font-bold tracking-widest text-[var(--content-tertiary)] uppercase">
                  ITEM {activeIndex + 1} OF {items.length} &mdash; <span className="text-[var(--content-secondary)]">ACTIVE</span>
                </p>
                {copiedId === `act-code-${activeItem.id}` || copiedId === `click-code-${activeItem.id}` || copiedId === `click-name-${activeItem.id}` ? (
                   <span className="text-xs font-bold text-[var(--content-positive)] flex items-center gap-1"><Check size={14} weight="bold" />Copied! Press Enter to advance</span>
                ) : (
                   <span className="text-xs font-semibold text-[var(--content-quaternary)]">Waiting to be copied</span>
                )}
              </div>
              
              <div className="bg-[var(--bg-secondary)] rounded-3xl p-8 lg:p-12 shadow-[var(--shadow-card-hover)] border border-[var(--border-subtle)]">
                {activeHasSpecialRate && (
                  <div className="mb-6 rounded-2xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 py-3 text-center">
                    <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--content-warning)]">
                      Special Rate Order
                    </p>
                    <p className="mt-1 text-sm text-[var(--content-warning)]">
                      Busy may show book price. Bill this line at{' '}
                      <span className="font-mono font-bold">{formatCurrency(activeQuotedPrice)}</span>
                      {activeBookPrice != null ? `, not ${formatCurrency(activeBookPrice)}` : ''}.
                    </p>
                  </div>
                )}

                {activeItem.item_alias ? (
                  <div className="mb-4 text-center cursor-pointer group" onClick={() => copy(activeItem.item_alias!, `click-code-${activeItem.id}`)}>
                    <h1 className="text-5xl lg:text-7xl font-mono font-bold text-[var(--content-primary)] tracking-tight inline-block relative transition-transform active:scale-95">
                      {activeItem.item_alias}
                      <span className="absolute -right-6 -top-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {copiedId === `click-code-${activeItem.id}` ? (
                          <Check size={20} className="text-[var(--content-positive)]" weight="bold" />
                        ) : (
                          <Copy size={20} className="text-[var(--content-tertiary)]" />
                        )}
                      </span>
                    </h1>
                  </div>
                ) : (
                  <div className="mb-4 text-center">
                    <span className="text-xl font-mono text-[var(--content-quaternary)]">No Code</span>
                  </div>
                )}
                
                <h3 
                  className="text-2xl text-[var(--content-secondary)] text-center font-medium leading-snug mb-10 cursor-pointer hover:opacity-80 transition-opacity group flex items-center justify-center gap-2"
                  onClick={() => copy(activeItem.item_name, `click-name-${activeItem.id}`)}
                >
                  {activeItem.item_name}
                  {!activeItem.item_alias && (
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                      {copiedId === `click-name-${activeItem.id}` ? (
                        <Check size={20} className="text-[var(--content-positive)]" weight="bold" />
                      ) : (
                        <Copy size={20} className="text-[var(--content-tertiary)]" />
                      )}
                    </span>
                  )}
                </h3>
                
                <div className="flex items-center justify-center gap-12 border-t border-[var(--border-faint)] mt-8 pt-8">
                  <div className="text-center">
                    <p className="text-xs uppercase tracking-wider text-[var(--content-tertiary)] mb-1">Quantity</p>
                    <p className="text-4xl font-mono font-bold text-[var(--content-primary)]">{activeItem.qty_requested}</p>
                  </div>
                  {activeQuotedPrice != null && (
                    <div className="text-center">
                      <p className="text-xs uppercase tracking-wider text-[var(--content-tertiary)] mb-1">
                        {activeHasSpecialRate ? 'Special Rate' : 'Rate'}
                      </p>
                      <p className={`text-2xl font-mono font-bold ${
                        activeHasSpecialRate ? 'text-[var(--content-warning)]' : 'text-[var(--content-secondary)]'
                      }`}>
                        {formatCurrency(activeQuotedPrice)}
                      </p>
                      {activeHasSpecialRate && activeBookPrice != null && (
                        <p className="mt-1 text-xs text-[var(--content-quaternary)]">
                          Book {formatCurrency(activeBookPrice)}
                        </p>
                      )}
                    </div>
                  )}
                  {activeItem.rack_no && (
                    <div className="text-center">
                      <p className="text-xs uppercase tracking-wider text-[var(--content-tertiary)] mb-1">Rack</p>
                      <p className="text-2xl font-mono font-bold text-[var(--content-secondary)]">{activeItem.rack_no}</p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="mt-10 flex flex-col items-center gap-4">
                <div className="flex items-center justify-center gap-4 text-sm text-[var(--content-tertiary)]">
                  <span className="flex items-center gap-1.5">
                    <kbd className="font-mono bg-[var(--bg-secondary)] border border-[var(--border-opaque)] rounded px-2 py-0.5 text-xs shadow-sm">Enter</kbd>
                    Copy & next
                  </span>
                  <span className="text-[var(--border-opaque)]">·</span>
                  <span className="flex items-center gap-1.5">
                    <kbd className="font-mono bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)] rounded px-2 py-0.5 text-xs shadow-sm text-[var(--content-warning)] font-bold">F</kbd>
                    No stock
                  </span>
                  <span className="text-[var(--border-opaque)]">·</span>
                  <span className="flex items-center gap-1.5">
                    <kbd className="font-mono bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)] rounded px-2 py-0.5 text-xs shadow-sm text-[var(--content-warning)] font-bold">P</kbd>
                    Partial
                  </span>
                </div>
                
                {!showFlagPanel ? (
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={onAdvance}
                      className="px-5 py-2.5 rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] text-sm font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                      Skip
                    </button>
                    <button 
                      onClick={() => setShowFlagPanel(true)}
                      className="px-5 py-2.5 rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-sm font-bold text-[var(--content-warning)] hover:opacity-90 transition-all flex items-center gap-2"
                    >
                      <Warning size={16} weight="fill" />
                      Flag Issue
                    </button>
                  </div>
                ) : (
                  <div className="w-full max-w-md bg-[var(--bg-secondary)] border-2 border-[var(--border-warning)] rounded-2xl p-5 animate-slide-up shadow-lg">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm font-bold text-[var(--content-warning)] flex items-center gap-2">
                        <Warning size={16} weight="fill" /> Flag this item
                      </p>
                      <button 
                        onClick={() => setShowFlagPanel(false)}
                        className="text-[var(--content-tertiary)] hover:text-[var(--content-primary)] transition-colors p-1"
                      >
                        <XCircle size={20} weight="fill" />
                      </button>
                    </div>
                    
                    <div className="space-y-3">
                      <button
                        onClick={() => {
                          onFlag(activeIndex, 'no_stock', 0);
                          setShowFlagPanel(false);
                        }}
                        className="w-full text-left p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:border-[var(--border-negative)] hover:bg-[var(--bg-negative-subtle)] transition-all"
                      >
                        <p className="text-sm font-bold text-[var(--content-primary)]">No stock in Busy</p>
                        <p className="text-xs text-[var(--content-secondary)] mt-1">Item is completely unavailable right now.</p>
                      </button>
                      
                      <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
                        <p className="text-sm font-bold text-[var(--content-primary)] mb-3">Partial stock</p>
                        <div className="flex items-center gap-3">
                          <input
                            ref={partialInputRef}
                            type="number"
                            value={partialQty}
                            onChange={(e) => setPartialQty(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && partialQty && Number(partialQty) > 0 && Number(partialQty) < activeItem.qty_requested) {
                                e.preventDefault();
                                e.stopPropagation();
                                onFlag(activeIndex, 'partial_stock', Number(partialQty));
                                setShowFlagPanel(false);
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setShowFlagPanel(false);
                              }
                            }}
                            placeholder={`Available (of ${activeItem.qty_requested})`}
                            min={1}
                            max={activeItem.qty_requested - 1}
                            className="flex-1 px-3 py-2.5 rounded-lg border border-[var(--border-opaque)] bg-[var(--bg-secondary)] text-sm font-mono text-[var(--content-primary)] focus:border-[var(--role-primary)] focus:ring-2 focus:ring-[var(--role-primary-subtle)] outline-none"
                          />
                          <button
                            disabled={!partialQty || Number(partialQty) <= 0 || Number(partialQty) >= activeItem.qty_requested}
                            onClick={() => {
                              onFlag(activeIndex, 'partial_stock', Number(partialQty));
                              setShowFlagPanel(false);
                            }}
                            className="px-4 py-2.5 rounded-lg bg-[var(--bg-warning)] text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-all"
                          >
                            Flag
                          </button>
                        </div>
                        <p className="text-xs text-[var(--content-tertiary)] mt-2">Enter how many are actually available.</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="max-w-md mx-auto text-center animate-slide-up">
              <div className="w-20 h-20 bg-[var(--bg-positive-subtle)] rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle size={40} weight="fill" className="text-[var(--content-positive)]" />
              </div>
              <h2 className="text-3xl font-bold text-[var(--content-primary)] mb-2">All Items Visited</h2>
              <p className="text-[var(--content-secondary)] mb-8">
                Data entry complete. Proceed to finalize.
              </p>
              <button
                onClick={onFinish}
                disabled={isSubmitting}
                className="h-16 px-8 rounded-2xl bg-[var(--bg-positive)] text-white text-lg font-bold shadow-lg hover:opacity-90 active:scale-95 transition-all w-full flex items-center justify-center gap-3 disabled:opacity-50"
              >
                {isSubmitting ? 'Approving...' : flagCount > 0 ? `Resolve ${flagCount} Flag${flagCount > 1 ? 's' : ''} & Approve` : 'Approve Order'}
                {!isSubmitting && <span className="text-sm font-normal opacity-80">(Enter)</span>}
              </button>
            </div>
          )}
        </div>

        {/* Right: Completed Checklist Panel */}
        <div className="lg:w-96 bg-[var(--bg-secondary)] border-l border-[var(--border-opaque)] flex flex-col h-64 lg:h-auto border-t lg:border-t-0 shrink-0">
          <div className="p-4 border-b border-[var(--border-faint)] bg-[var(--bg-tertiary)] shrink-0">
            <h3 className="text-sm font-bold tracking-wider text-[var(--content-secondary)] uppercase">
              Completed ({previousItems.length})
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 relative">
            {previousItems.length === 0 ? (
              <p className="text-sm text-[var(--content-quaternary)] text-center py-8">
                No items completed yet.
              </p>
            ) : (
              previousItems.map((item, localIndex) => {
                // Find actual original index to jump properly
                const originalIndex = activeIndex - 1 - localIndex;
                const isNewest = localIndex === 0 && direction === 'forward';
                const isFlagged = originalIndex in manualFlags;
                
                return (
                 <div 
                   key={item.id} 
                   onClick={() => onJump(originalIndex)}
                   className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer hover:opacity-100 hover:bg-[var(--bg-tertiary)] transition-all ${
                     isFlagged 
                       ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] opacity-90' 
                       : isNewest 
                         ? 'animate-slide-in-right bg-[var(--bg-positive-subtle)] border-[var(--border-subtle)] opacity-70' 
                         : 'bg-[var(--bg-primary)] border-[var(--border-subtle)] opacity-70'
                   }`}
                   title={isFlagged ? 'Flagged — click to review' : 'Click to jump back to this item'}
                 >
                  <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                    isFlagged ? 'bg-[var(--bg-warning-subtle)]' : 'bg-[var(--bg-positive-subtle)]'
                  }`}>
                    {isFlagged ? (
                      <Warning size={12} weight="fill" className="text-[var(--content-warning)]" />
                    ) : (
                      <Check size={12} weight="bold" className="text-[var(--content-positive)]" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-mono font-bold truncate ${
                      isFlagged 
                        ? 'text-[var(--content-warning)]' 
                        : 'text-[var(--content-primary)] line-through decoration-[var(--border-opaque)] decoration-2'
                    }`}>
                       {item.item_alias || 'NO CODE'}
                    </p>
                    <p className="text-xs text-[var(--content-secondary)] truncate">
                      {item.item_name}
                    </p>
                    {isFlagged && (
                      <p className="text-xs font-semibold text-[var(--content-warning)] mt-1">
                        {manualFlags[originalIndex].type === 'no_stock' ? '⚠ No stock' : `⚠ Only ${manualFlags[originalIndex].availableQty} available`}
                      </p>
                    )}
                  </div>
                  <div className="text-xs font-mono font-bold text-[var(--content-tertiary)]">
                    {item.qty_requested}
                  </div>
                </div>
              );
             })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
