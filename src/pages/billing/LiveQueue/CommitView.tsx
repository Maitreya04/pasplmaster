import { useState, type ReactElement } from 'react';
import { ArrowLeft, Warning, Copy, Check, ArrowRight } from '@phosphor-icons/react';
import type { OrderItem } from '../../../types';
import { formatCurrency, formatTimeAgo } from '../../../utils/formatters';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';

interface CommitViewProps {
  orderName: string;
  orderNumber: string;
  salesperson: string | null;
  city: string | null;
  itemCount: number;
  totalValue: number;
  priority: string;
  createdAt: string;
  items: OrderItem[];
  onCommit: () => void;
  onSkip: () => void;
  isClaiming: boolean;
}

export function CommitView({
  orderName,
  orderNumber,
  salesperson,
  city,
  itemCount,
  totalValue,
  priority,
  createdAt,
  items,
  onCommit,
  onSkip,
  isClaiming
}: CommitViewProps): ReactElement {

  const { copy, copiedId } = useCopyToClipboard();
  const [hasCopied, setHasCopied] = useState(false);
  const flaggedItems = items.filter(i => i.state === 'flagged').length;
  const noStockItems = items.filter(i => i.qty_shippable === 0).length;
  const totalIssues = flaggedItems + noStockItems;

  const copyAllItems = () => {
    const text = items
      .map(i => `${i.item_name}\t${i.qty_requested}`)
      .join('\n');
    copy(text, 'all-items');
    setHasCopied(true);
  };

  const isCopied = copiedId === 'all-items';

  return (
    <div className="density-compact min-h-screen bg-[var(--bg-primary)] p-4 sm:p-8 flex flex-col justify-center max-w-2xl mx-auto animate-slide-up">

      <button
        onClick={onSkip}
        className="self-start inline-flex items-center gap-2 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)] mb-12 transition-colors px-3 py-2 -ml-3 rounded-lg hover:bg-[var(--bg-tertiary)]"
      >
        <ArrowLeft size={16} weight="bold" />
        Skip this order
      </button>

      {/* ── Order hero ── */}
      <div className="space-y-6">
        {priority === 'urgent' && (
          <span className="inline-block px-3 py-1 rounded-md bg-[var(--bg-negative)] text-white text-sm font-bold tracking-widest uppercase">
            Urgent
          </span>
        )}

        <div>
          <h2 className="text-4xl sm:text-5xl font-bold text-[var(--content-primary)] leading-tight mb-3">
            {orderName}
          </h2>
          <p className="text-xl text-[var(--content-secondary)] font-medium flex flex-wrap gap-2 items-center">
            {city && <span>{city} <span className="text-[var(--content-quaternary)]">·</span></span>}
            {salesperson && <span>{salesperson} <span className="text-[var(--content-quaternary)]">·</span></span>}
            <span className="font-mono text-base">{orderNumber}</span>
          </p>
        </div>

        <div className="flex gap-6 py-6 border-y border-[var(--border-opaque)]">
          <div>
            <p className="text-sm font-semibold text-[var(--content-tertiary)] uppercase tracking-wider mb-1">Items</p>
            <p className="text-2xl font-mono font-bold text-[var(--content-primary)]">{itemCount}</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--content-tertiary)] uppercase tracking-wider mb-1">Value</p>
            <p className="text-2xl font-mono font-bold text-[var(--content-primary)]">{formatCurrency(totalValue)}</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--content-tertiary)] uppercase tracking-wider mb-1">Age</p>
            <p className="text-xl font-medium text-[var(--content-secondary)] pt-1">{formatTimeAgo(createdAt)}</p>
          </div>
        </div>

        {totalIssues > 0 && (
          <div className="bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)] p-4 rounded-xl flex items-start gap-3">
            <Warning size={24} weight="fill" className="text-[var(--content-warning)] shrink-0 mt-0.5" />
            <div>
              <p className="text-base font-bold text-[var(--content-warning)]">
                {totalIssues} item{totalIssues !== 1 ? 's' : ''} have issues
              </p>
              <p className="text-sm text-[var(--content-warning)] opacity-90 mt-1">
                You will need to resolve these after data entry.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Guided steps ── */}
      <div className="mt-14 space-y-4">

        <p className="text-xs font-bold tracking-widest text-[var(--content-tertiary)] uppercase mb-1">
          Steps
        </p>

        {/* Step 1: Open in Busy */}
        <div className="flex items-start gap-4 p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
          <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-opaque)] flex items-center justify-center shrink-0 mt-0.5">
            {hasCopied ? (
              <Check size={16} weight="bold" className="text-[var(--content-positive)]" />
            ) : (
              <span className="text-sm font-bold text-[var(--content-secondary)]">1</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[var(--content-primary)] mb-1">
              Select <span className="font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded text-base">{orderName}</span> in Busy
            </p>
            <p className="text-xs text-[var(--content-tertiary)]">
              Create the voucher with the party name above
            </p>
          </div>
        </div>

        {/* Step 2: Copy all items */}
        <div className="flex items-start gap-4 p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
          <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-opaque)] flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-sm font-bold text-[var(--content-secondary)]">2</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[var(--content-primary)] mb-3">
              Copy items &amp; paste into Busy
            </p>
            <button
              onClick={copyAllItems}
              className={`w-full h-12 rounded-xl text-base font-bold active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${
                isCopied
                  ? 'bg-[var(--bg-positive-subtle)] border-2 border-[var(--border-positive)] text-[var(--content-positive)]'
                  : 'bg-[var(--role-primary)] text-white shadow-[0_4px_12px_rgba(37,99,235,0.15)] hover:opacity-90'
              }`}
            >
              {isCopied ? (
                <>
                  <Check size={20} weight="bold" />
                  Copied {items.length} items — paste in Busy
                </>
              ) : (
                <>
                  <Copy size={20} weight="bold" />
                  Copy {items.length} Items
                </>
              )}
            </button>
            <p className="text-xs text-[var(--content-tertiary)] mt-2">
              Click the first item cell in Busy, then Ctrl+V
            </p>
          </div>
        </div>

        {/* Step 3: Proceed to review */}
        <div className="flex items-start gap-4 p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
          <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-opaque)] flex items-center justify-center shrink-0 mt-0.5">
            <span className="text-sm font-bold text-[var(--content-secondary)]">3</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-[var(--content-primary)] mb-3">
              Review items for stock issues
            </p>
            <button
              onClick={onCommit}
              disabled={isClaiming}
              className="w-full h-12 rounded-xl border-2 border-[var(--border-opaque)] bg-[var(--bg-primary)] text-[var(--content-primary)] text-base font-bold hover:bg-[var(--bg-tertiary)] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isClaiming ? 'Claiming...' : (
                <>
                  Pasted in Busy — Review Items
                  <ArrowRight size={18} weight="bold" />
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
