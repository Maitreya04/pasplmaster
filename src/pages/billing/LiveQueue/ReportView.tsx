import { useEffect, useMemo, type ReactElement } from 'react';
import { CheckCircle, Copy, Check, WhatsappLogo, ArrowRight } from '@phosphor-icons/react';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import type { OrderItem } from '../../../types';
import type { ItemFlag } from '../../../hooks/useBillingFlow';

interface ReportViewProps {
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

  lines.push(`Hi ${salesperson || 'Team'} — billing update for order ${orderNumber} (${orderName}):`);

  const partialItems: string[] = [];
  const noStockItems: string[] = [];
  let billedCount = 0;

  items.forEach((item, index) => {
    const flag = flags[index];
    if (!flag) {
      billedCount++;
      return;
    }
    const label = item.item_alias ? `${item.item_alias} ${item.item_name}` : item.item_name;
    if (flag.type === 'partial' && flag.availableQty != null) {
      const pending = item.qty_requested - flag.availableQty;
      partialItems.push(`• ${label}: Ordered ${item.qty_requested}, billed ${flag.availableQty}, ${pending} pending`);
    } else {
      noStockItems.push(`• ${label}: Ordered ${item.qty_requested}, fully pending (no stock)`);
    }
  });

  if (partialItems.length > 0) {
    lines.push(`⚠️ Partial stock:\n${partialItems.join('\n')}`);
  }
  if (noStockItems.length > 0) {
    lines.push(`❌ Out of stock:\n${noStockItems.join('\n')}`);
  }
  if (billedCount > 0) {
    lines.push(`✅ ${billedCount} item${billedCount !== 1 ? 's' : ''} billed as ordered.`);
  }

  lines.push('Order approved and sent to picking.');
  return lines.join('\n\n');
}

export function ReportView({
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

  const reportText = useMemo(
    () => buildReportText({ orderNumber, orderName, salesperson, items, flags }),
    [orderNumber, orderName, salesperson, items, flags],
  );

  const flagCount = Object.keys(flags).length;
  const billedCount = items.length - flagCount;

  // Keyboard shortcuts
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

  // Clean order — minimal view
  if (!hasFlags) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center p-6 animate-slide-up">
        <div className="w-full max-w-md text-center">
          <div className="w-20 h-20 bg-[var(--bg-positive-subtle)] rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle size={44} weight="fill" className="text-[var(--content-positive)]" />
          </div>
          <h2 className="text-2xl font-bold text-[var(--content-primary)] mb-2">
            {orderName} — billed
          </h2>
          <p className="text-base text-[var(--content-secondary)] mb-10">
            All {items.length} items billed successfully. No issues to report.
          </p>
          <button
            onClick={onNext}
            className="w-full h-14 rounded-2xl bg-[var(--role-primary)] text-white text-base font-bold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all shadow-md"
          >
            Next order
            {totalWaiting > 0 && (
              <span className="text-sm font-normal opacity-80">({totalWaiting} remaining)</span>
            )}
            <ArrowRight size={18} weight="bold" />
          </button>
          <p className="text-xs text-[var(--content-quaternary)] mt-4">
            Press Enter
          </p>
        </div>
      </div>
    );
  }

  // Flagged order — full report
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex flex-col items-center justify-center p-4 sm:p-6 animate-slide-up">
      <div className="w-full max-w-xl">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-[var(--bg-positive-subtle)] rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={36} weight="fill" className="text-[var(--content-positive)]" />
          </div>
          <h2 className="text-2xl font-bold text-[var(--content-primary)] mb-1">
            {orderName} — billed
          </h2>
          <p className="text-sm text-[var(--content-secondary)]">
            {billedCount} billed · {flagCount} flagged
          </p>
        </div>

        {/* Report card */}
        <div className="bg-[var(--bg-secondary)] rounded-2xl p-6 shadow-[var(--shadow-card)] border border-[var(--border-subtle)] relative mb-6">
          {/* Copy button top-right */}
          <button
            onClick={() => copy(reportText, 'report')}
            className="absolute top-4 right-4 p-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-accent-subtle)] transition-colors text-[var(--content-secondary)]"
            title="Copy report (C)"
          >
            {copiedId === 'report' ? (
              <Check size={18} weight="bold" className="text-[var(--content-positive)]" />
            ) : (
              <Copy size={18} />
            )}
          </button>

          {/* Report content with WhatsApp styling */}
          <div className="bg-[#EFEAE2] dark:bg-[#0b141a] rounded-xl p-5 border border-[var(--border-opaque)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-[#25D366]" />
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-[#111B21] dark:text-[#E9EDEF] pl-2">
              {reportText}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mb-4">
          <button
            onClick={() => copy(reportText, 'report')}
            className={`flex-1 h-12 rounded-xl border-2 text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
              copiedId === 'report'
                ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
                : 'border-[var(--border-opaque)] bg-[var(--bg-secondary)] text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            {copiedId === 'report' ? (
              <>
                <Check size={18} weight="bold" />
                Copied!
              </>
            ) : (
              <>
                <Copy size={18} />
                Copy
              </>
            )}
          </button>

          <button
            onClick={() => {
              // Copy first, then open WhatsApp
              copy(reportText, 'report');
              // Open WhatsApp with pre-filled text
              const encoded = encodeURIComponent(reportText);
              window.open(`https://wa.me/?text=${encoded}`, '_blank');
            }}
            className="flex-1 h-12 rounded-xl bg-[#25D366] text-white text-sm font-bold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all"
          >
            <WhatsappLogo size={20} weight="fill" />
            WhatsApp {salesperson || ''}
          </button>
        </div>

        <button
          onClick={onNext}
          className="w-full h-14 rounded-2xl bg-[var(--role-primary)] text-white text-base font-bold flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.98] transition-all shadow-md"
        >
          Next order
          {totalWaiting > 0 && (
            <span className="text-sm font-normal opacity-80">({totalWaiting} remaining)</span>
          )}
          <ArrowRight size={18} weight="bold" />
        </button>
        <p className="text-center text-xs text-[var(--content-quaternary)] mt-3">
          C copy · Enter next order
        </p>

      </div>
    </div>
  );
}
