import { useEffect, useMemo, type ReactElement } from 'react';
import { CheckCircle, ArrowRight } from '@phosphor-icons/react';
import { BillingBillHeader } from '../../../components/billing/chrome/BillingBillHeader';
import { BillingOrderChrome } from '../../../components/billing/chrome/BillingOrderChrome';
import { CompleteHandoffStage } from '../../../components/billing/stages/CompleteHandoffStage';
import type { FulfillmentPath, OrderItem } from '../../../types';
import type { ItemFlag } from '../../../hooks/useBillingFlow';

interface ReportViewProps {
  embedded?: boolean;
  orderName: string;
  orderNumber: string;
  salesperson: string | null;
  items: OrderItem[];
  flags: Record<number, ItemFlag>;
  resolvedFulfillmentPath?: FulfillmentPath;
  effectivePickLineCount?: number;
  totalWaiting: number;
  onNext: () => void;
}

export function ReportView({
  embedded = false,
  orderName,
  orderNumber,
  salesperson,
  items,
  flags,
  resolvedFulfillmentPath = 'warehouse_pick',
  effectivePickLineCount = 0,
  totalWaiting,
  onNext,
}: ReportViewProps): ReactElement {
  const hasFlags = Object.keys(flags).length > 0;
  const sentToPick =
    resolvedFulfillmentPath === 'warehouse_pick' && effectivePickLineCount > 0;

  const shellClass = embedded
    ? 'density-compact h-full min-h-0 flex flex-col overflow-hidden animate-slide-up'
    : 'density-compact min-h-screen flex flex-col animate-slide-up';

  const summaryLine = useMemo(() => {
    if (hasFlags) {
      const billedCount = items.filter((item) => !flags[item.id]).length;
      return `${billedCount} billed · ${items.filter((item) => !!flags[item.id]).length} flagged`;
    }
    return sentToPick
      ? `All ${items.length} items billed. Sent to warehouse pick.`
      : `All ${items.length} items billed. Direct bill — no warehouse pick.`;
  }, [hasFlags, items, flags, sentToPick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNext]);

  return (
    <div className={shellClass}>
      <BillingOrderChrome
        stage="done"
        embedded={embedded}
        billHeader={
          <BillingBillHeader
            customerName={orderName}
            orderId={orderNumber}
          />
        }
        context={{
          salesperson,
        }}
      >
        {!hasFlags ? (
          <div className="px-4 py-3 text-center border-b border-[var(--border-faint)] bg-[var(--bg-positive-subtle)]/30">
            <div className="flex items-center justify-center gap-2 font-ds-caption-size font-medium text-[var(--content-positive)]">
              <CheckCircle size={18} weight="fill" />
              Billed successfully · {summaryLine}
            </div>
          </div>
        ) : null}
        <CompleteHandoffStage
          variant="report"
          orderNumber={orderNumber}
          orderName={orderName}
          salesperson={salesperson}
          items={items}
          flags={flags}
          resolvedFulfillmentPath={resolvedFulfillmentPath}
          effectivePickLineCount={effectivePickLineCount}
          totalWaiting={totalWaiting}
          onNext={onNext}
        />
      </BillingOrderChrome>
      {!hasFlags ? (
        <div className="shrink-0 px-4 pb-4">
          <button
            type="button"
            onClick={onNext}
            className="w-full max-w-sm mx-auto h-12 rounded-xl bg-[var(--role-primary)] text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all shadow-sm"
          >
            Next order
            {totalWaiting > 0 ? (
              <span className="text-xs font-normal opacity-80">
                ({totalWaiting} remaining)
              </span>
            ) : null}
            <ArrowRight size={16} weight="bold" />
          </button>
          <p className="text-center font-ds-label-size text-[var(--content-quaternary)] mt-3">
            Press Enter
          </p>
        </div>
      ) : null}
    </div>
  );
}
