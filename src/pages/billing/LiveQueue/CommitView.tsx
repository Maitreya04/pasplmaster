import { ArrowLeft, Warning } from '@phosphor-icons/react';
import type { OrderItem } from '../../../types';
import { formatCurrency, formatTimeAgo } from '../../../utils/formatters';

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
}: CommitViewProps): JSX.Element {
  
  const flaggedItems = items.filter(i => i.state === 'flagged').length;
  const noStockItems = items.filter(i => i.qty_shippable === 0).length;
  const totalIssues = flaggedItems + noStockItems;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] p-4 sm:p-8 flex flex-col justify-center max-w-2xl mx-auto animate-slide-up">
      
      <button 
        onClick={onSkip}
        className="self-start inline-flex items-center gap-2 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)] mb-12 transition-colors px-3 py-2 -ml-3 rounded-lg hover:bg-[var(--bg-tertiary)]"
      >
        <ArrowLeft size={16} weight="bold" />
        Skip this order
      </button>

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

      <div className="mt-16">
        <button
          onClick={onCommit}
          disabled={isClaiming}
          className="w-full h-16 rounded-2xl bg-[var(--role-primary)] text-white text-lg font-bold hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-50 shadow-[0_4px_12px_rgba(37,99,235,0.15)] focus:ring-4 focus:ring-[var(--role-primary-subtle)] outline-none"
        >
          {isClaiming ? 'Claiming...' : 'Open in Busy, then show items'}
        </button>
      </div>

    </div>
  );
}
