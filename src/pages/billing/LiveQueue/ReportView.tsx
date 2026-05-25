import { useEffect, useMemo, type ReactElement } from 'react';
import { CheckCircle, Copy, Check, WhatsappLogo, ArrowRight } from '@phosphor-icons/react';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import { orderLineLabel } from '../../../utils/formatters';
import type { OrderItem } from '../../../types';
import type { ItemFlag } from '../../../hooks/useBillingFlow';

interface ReportViewProps {
  embedded?: boolean;
  orderName: string;
  orderNumber: string;
  salesperson: string | null;
  items: OrderItem[];
  flags: Record<number, ItemFlag>;
  totalWaiting: number;
  onNext: () => void;
}

function buildReportText(params: {
  orderNumber: string;
  orderName: string;
  salesperson: string | null;
  items: OrderItem[];
  flags: Record<number, ItemFlag>;
}): string {
  const { orderNumber, orderName, salesperson, items, flags } = params;
  const lines: string[] = [];

  const num = orderNumber.trim();
  const orderHead =
    num.length > 0
      ? `order ${num} (${orderName})`
      : `order for ${orderName}`;
  lines.push(`Hi ${salesperson || 'Team'} — billing update for ${orderHead}:`);

  const partialItems: string[] = [];
  const noStockItems: string[] = [];
  let billedCount = 0;

  items.forEach((item) => {
    const flag = flags[item.id];
    if (!flag) {
      billedCount++;
      return;
    }
    const label = orderLineLabel(item);
    if (flag.type === 'partial' && flag.availableQty != null) {
      const pending = item.qty_requested - flag.availableQty;
      partialItems.push(`• ${label}: Ordered ${item.qty_requested}, billed ${flag.availableQty}, ${pending} pending`);
    } else {
      noStockItems.push(`• ${label}: Ordered ${item.qty_requested}, fully pending (no stock)`);
    }
  });

  if (partialItems.length > 0) {
    lines.push(`Partial stock:\n${partialItems.join('\n')}`);
  }
  if (noStockItems.length > 0) {
    lines.push(`Out of stock:\n${noStockItems.join('\n')}`);
  }
  if (billedCount > 0) {
    lines.push(`${billedCount} item${billedCount !== 1 ? 's' : ''} billed as ordered.`);
  }

  lines.push('Order approved and sent to picking.');
  return lines.join('\n\n');
}

export function ReportView({
  embedded = false,
  orderName,
  orderNumber,
  salesperson,
  items,
  flags,
  totalWaiting,
  onNext,
}: ReportViewProps): ReactElement {
  const { copy, copiedId } = useCopyToClipboard();
  const hasFlags = Object.keys(flags).length > 0;

  const shellClass = embedded
    ? 'density-compact h-full min-h-0 bg-[var(--bg-primary)] flex flex-col items-center justify-center p-4 animate-slide-up overflow-y-auto'
    : 'density-compact min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center p-6 animate-slide-up';

  const flaggedShellClass = embedded
    ? 'density-compact h-full min-h-0 bg-[var(--bg-primary)] flex flex-col items-center justify-center p-3 animate-slide-up overflow-y-auto'
    : 'density-compact min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center p-4 lg:p-6 animate-slide-up';

  const reportText = useMemo(
    () => buildReportText({ orderNumber, orderName, salesperson, items, flags }),
    [orderNumber, orderName, salesperson, items, flags],
  );

  const billedCount = items.filter((item) => !flags[item.id]).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        copy(reportText, 'report');
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [copy, reportText, onNext]);

  // Clean order — minimal success view
  if (!hasFlags) {
    return (
      <div className={shellClass}>
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 bg-[var(--bg-positive-subtle)] rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={36} weight="fill" className="text-[var(--content-positive)]" />
          </div>
          <h2 className="text-xl font-bold text-[var(--content-primary)] mb-1">
            {orderName} — billed
          </h2>
          <p className="text-sm text-[var(--content-secondary)] mb-8">
            All {items.length} items billed. Sent to picking.
          </p>
          <button
            onClick={onNext}
            className="w-full h-12 rounded-xl bg-[var(--role-primary)] text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all shadow-sm"
          >
            Next order
            {totalWaiting > 0 && (
              <span className="text-xs font-normal opacity-80">({totalWaiting} remaining)</span>
            )}
            <ArrowRight size={16} weight="bold" />
          </button>
          <p className="font-ds-label-size text-[var(--content-quaternary)] mt-3">
            Press Enter
          </p>
        </div>
      </div>
    );
  }

  // Flagged order — full report
  return (
    <div className={flaggedShellClass}>
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="text-center mb-5">
          <div className="w-14 h-14 bg-[var(--bg-positive-subtle)] rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={32} weight="fill" className="text-[var(--content-positive)]" />
          </div>
          <h2 className="text-xl font-bold text-[var(--content-primary)] mb-1">
            {orderName} — billed
          </h2>
          <p className="text-xs text-[var(--content-secondary)]">
            {billedCount} billed · {items.filter((item) => !!flags[item.id]).length} flagged
          </p>
        </div>

        {/* Report card */}
        <div className="ds-card p-5 relative mb-5">
          {/* Copy icon */}
          <button
            onClick={() => copy(reportText, 'report')}
            className="absolute top-3 right-3 p-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-accent-subtle)] transition-colors text-[var(--content-secondary)]"
            title="Copy report (C)"
          >
            {copiedId === 'report' ? (
              <Check size={16} weight="bold" className="text-[var(--content-positive)]" />
            ) : (
              <Copy size={16} />
            )}
          </button>

          {/* WhatsApp-style message bubble */}
          <div className="rounded-xl p-4 border border-[var(--border-subtle)] relative overflow-hidden bg-[var(--embed-whatsapp-bg)]">
            <div className="absolute top-0 left-0 w-1 h-full bg-embed-whatsapp-solid" aria-hidden />
            <p className="font-ds-prose leading-relaxed whitespace-pre-wrap text-[var(--embed-whatsapp-fg)] pl-2">
              {reportText}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mb-4">
          <button
            onClick={() => copy(reportText, 'report')}
            className={`flex-1 h-11 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
              copiedId === 'report'
                ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
                : 'border-[var(--border-opaque)] bg-[var(--bg-secondary)] text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            {copiedId === 'report' ? (
              <><Check size={16} weight="bold" /> Copied!</>
            ) : (
              <><Copy size={16} /> Copy</>
            )}
          </button>

          <button
            onClick={() => {
              copy(reportText, 'report');
              const encoded = encodeURIComponent(reportText);
              window.open(
                `https://api.whatsapp.com/send?text=${encoded}`,
                '_blank',
                'noopener,noreferrer',
              );
            }}
            className="flex-1 h-11 rounded-xl bg-embed-whatsapp-solid text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all"
          >
            <WhatsappLogo size={18} weight="fill" />
            WhatsApp {salesperson || ''}
          </button>
        </div>

        <button
          onClick={onNext}
          className="w-full h-12 rounded-xl bg-[var(--role-primary)] text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all shadow-sm"
        >
          Next order
          {totalWaiting > 0 && (
            <span className="text-xs font-normal opacity-80">({totalWaiting} remaining)</span>
          )}
          <ArrowRight size={16} weight="bold" />
        </button>
        <p className="text-center font-ds-label-size text-[var(--content-quaternary)] mt-3">
          C copy · Enter next order
        </p>

      </div>
    </div>
  );
}
