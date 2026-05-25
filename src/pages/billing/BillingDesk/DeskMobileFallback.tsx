import { Link } from 'react-router-dom';
import { Desktop, Lightning, PlusCircle } from '@phosphor-icons/react';

export function DeskMobileFallback(): React.JSX.Element {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center lg:hidden">
      <div className="w-14 h-14 rounded-full bg-[var(--bg-accent-subtle)] flex items-center justify-center mb-4">
        <Desktop size={28} className="text-[var(--content-accent)]" />
      </div>
      <h1 className="text-lg font-semibold text-[var(--content-primary)]">Billing Desk is desktop-only</h1>
      <p className="mt-2 max-w-sm text-sm text-[var(--content-tertiary)]">
        Open this view on a large screen for the split-panel desk. On mobile, use Live Queue or New Order.
      </p>
      <div className="mt-6 flex flex-col sm:flex-row gap-3 w-full max-w-xs">
        <Link
          to="/billing/queue"
          className="flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-xl bg-[var(--role-primary)] text-white text-sm font-semibold no-underline"
        >
          <Lightning size={18} weight="fill" />
          Live Queue
        </Link>
        <Link
          to="/billing/new-order"
          className="flex-1 inline-flex items-center justify-center gap-2 h-11 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-sm font-semibold text-[var(--content-primary)] no-underline"
        >
          <PlusCircle size={18} />
          New Order
        </Link>
      </div>
    </div>
  );
}
