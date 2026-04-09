import { Warning, Question } from '@phosphor-icons/react';
import type { OrderItem } from '../../../types';
import type { FlagIssue, ResolveDecision } from '../../../hooks/useBillingFlowMachine';

interface ResolveViewProps {
  orderName: string;
  item: OrderItem;
  issue: FlagIssue;
  issueIndex: number;
  totalIssues: number;
  overrideAvailable?: number;
  onDecide: (decision: ResolveDecision) => void;
  onPark: () => void;
}

export function ResolveView({
  orderName,
  item,
  issue,
  issueIndex,
  totalIssues,
  overrideAvailable,
  onDecide,
  onPark,
}: ResolveViewProps): JSX.Element {
  
  const requested = item.qty_requested;
  const available = overrideAvailable ?? item.qty_shippable ?? 0;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center p-6 animate-slide-up">
      
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <p className="text-sm font-bold tracking-widest uppercase text-[var(--content-tertiary)] mb-2">
            Issue {issueIndex + 1} of {totalIssues}
          </p>
          <h2 className="text-xl text-[var(--content-secondary)] truncate px-4">{orderName}</h2>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-3xl p-8 lg:p-10 shadow-[var(--shadow-card-hover)] border-2 border-[var(--border-warning)]">
          <div className="flex items-start gap-4 mb-8">
            <div className="mt-1">
              <Warning size={32} weight="fill" className="text-[var(--content-warning)]" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-[var(--content-primary)] mb-2">
                {issue.type === 'no_stock' ? 'No stock in Busy' 
                  : issue.type === 'partial_stock' ? 'Partial stock in Busy' 
                  : 'Needs Supervisor Attention'}
              </h3>
              <p className="text-lg text-[var(--content-secondary)] mb-1 font-medium">{item.item_name}</p>
              {item.item_alias && <p className="font-mono text-sm text-[var(--content-tertiary)]">{item.item_alias}</p>}
              
              <div className="mt-4 p-3 bg-[var(--bg-warning-subtle)] rounded-xl border border-[var(--border-warning)] inline-block">
                <p className="text-sm font-bold text-[var(--content-warning)]">{issue.description}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-semibold text-[var(--content-tertiary)] tracking-wide uppercase px-2">Decision</p>
            
            {(issue.type === 'no_stock' || issue.type === 'partial_stock') && (
              <>
                <button
                  className="w-full text-left bg-[var(--bg-primary)] border border-[var(--border-subtle)] p-5 rounded-2xl hover:border-[var(--role-primary)] hover:bg-[var(--role-primary-subtle)] hover:shadow-sm transition-all focus:ring-4 focus:ring-[var(--role-primary-subtle)] outline-none group"
                  onClick={() => onDecide('bill_available_po_rest')}
                >
                  <p className="text-lg font-bold text-[var(--content-primary)] group-hover:text-[var(--role-content)] flex items-center gap-2">
                    Bill {available}, mark {requested - available} pending (PO)
                  </p>
                  <p className="text-sm text-[var(--content-secondary)] mt-1">
                    Adds remaining quantity to Pending list for later tracking.
                  </p>
                </button>
                
                <button
                  className="w-full text-left bg-[var(--bg-primary)] border border-[var(--border-subtle)] p-5 rounded-2xl hover:border-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] hover:shadow-sm transition-all focus:ring-4 focus:ring-[var(--border-opaque)] outline-none"
                  onClick={() => onDecide('bill_available')}
                >
                  <p className="text-lg font-bold text-[var(--content-primary)]">
                    Bill {available} only, drop the rest
                  </p>
                  <p className="text-sm text-[var(--content-secondary)] mt-1">
                    Customer doesn't need it later. Reduces order size permanently.
                  </p>
                </button>
              </>
            )}

            <button
              className="w-full text-left bg-[var(--bg-primary)] border border-[var(--border-subtle)] p-5 rounded-2xl hover:border-[var(--border-negative)] hover:bg-[var(--bg-negative-subtle)] hover:shadow-sm transition-all outline-none"
              onClick={() => onDecide('drop_entirely')}
            >
              <p className="text-lg font-bold text-[var(--content-negative)]">
                 Remove this item entirely
              </p>
            </button>
          </div>
        </div>

        <div className="mt-8">
          <button 
            onClick={onPark}
            className="w-full p-4 flex items-center justify-center gap-3 rounded-2xl border-2 border-[var(--border-opaque)] bg-transparent text-[var(--content-secondary)] font-bold hover:bg-[var(--bg-tertiary)] hover:text-[var(--content-primary)] transition-colors group"
          >
            <Question size={24} className="group-hover:text-[var(--content-primary)] text-[var(--content-tertiary)]" />
            I can't resolve this right now — Park Order
          </button>
          <p className="text-xs text-center text-[var(--content-quaternary)] mt-3 px-8">
            This will drop the entire order out of your Live Queue into "Needs Review" so a supervisor can look at it. You will move to the next order.
          </p>
        </div>

      </div>
    </div>
  );
}
