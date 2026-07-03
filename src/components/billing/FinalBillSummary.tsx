import { useId, useState } from 'react';
import { CaretDown, CaretRight, Warning } from '@phosphor-icons/react';
import {
  finalBillCopyTotals,
  finalBillCopyWarningLabel,
  type FinalBillCopyRow,
  type FinalBillSkipRow,
  type FinalBillCopyWarning,
} from '../../lib/billing/finalBillCopy';
import { formatCurrencyRaw } from '../../utils/formatters';
import { formatRoundedRs } from '../../lib/billing/mrpWorkflowCopy';

interface FinalBillSummaryProps {
  rows: FinalBillCopyRow[];
  pickerOosRows: FinalBillSkipRow[];
  pendingCount: number;
  unresolvedCount: number;
}

function warningSummaryLabel(warning: FinalBillCopyWarning, count: number): string {
  const base = finalBillCopyWarningLabel(warning).toLowerCase();
  return count === 1 ? `1 ${base}` : `${count} ${base}`;
}

export function FinalBillSummary({
  rows,
  pickerOosRows,
  pendingCount,
  unresolvedCount,
}: FinalBillSummaryProps): React.JSX.Element | null {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  const totals = finalBillCopyTotals(rows);
  if (rows.length === 0 && unresolvedCount === 0 && pendingCount === 0 && pickerOosRows.length === 0) {
    return null;
  }

  const pickerOosQty = pickerOosRows.reduce((sum, row) => sum + row.qty, 0);
  const warningCounts = rows.reduce(
    (acc, row) => {
      for (const warning of row.warnings) {
        acc.set(warning, (acc.get(warning) ?? 0) + 1);
      }
      return acc;
    },
    new Map<FinalBillCopyWarning, number>(),
  );
  const hasWarnings = warningCounts.size > 0;

  const metricParts: string[] = [];
  if (totals.lineCount > 0) {
    metricParts.push(`${totals.lineCount} row${totals.lineCount === 1 ? '' : 's'}`);
    metricParts.push(`${totals.qtyTotal} pcs`);
  }
  if (pickerOosRows.length > 0) {
    metricParts.push(`${pickerOosRows.length} picker OOS`);
  } else if (pendingCount > 0) {
    metricParts.push(`${pendingCount} pending`);
  }
  if (unresolvedCount > 0) {
    metricParts.push(`${unresolvedCount} unresolved`);
  }

  const warningBrief = hasWarnings
    ? Array.from(warningCounts.entries())
        .map(([warning, count]) => warningSummaryLabel(warning, count))
        .join(' · ')
    : null;

  return (
    <section
      className={`shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] ${
        expanded ? 'shadow-sm' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="group flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--border-selected)]"
      >
        <span
          className="mt-0.5 shrink-0 text-[var(--content-tertiary)] transition-transform group-hover:text-[var(--content-secondary)]"
          aria-hidden
        >
          {expanded ? (
            <CaretDown size={14} weight="bold" />
          ) : (
            <CaretRight size={14} weight="bold" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xs font-bold uppercase tracking-wide text-[var(--content-secondary)]">
              Final bill
            </span>
            {metricParts.length > 0 ? (
              <span className="text-[11px] font-medium text-[var(--content-tertiary)]">
                {metricParts.join(' · ')}
              </span>
            ) : null}
          </span>

          {!expanded && warningBrief ? (
            <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-[var(--content-warning-on-light)]">
              <Warning size={12} weight="fill" className="shrink-0" aria-hidden />
              {warningBrief}
            </span>
          ) : null}

          {!expanded && unresolvedCount > 0 && rows.length === 0 ? (
            <span className="mt-1 block text-[11px] font-semibold text-[var(--content-warning-on-light)]">
              Resolve flagged lines before finalising.
            </span>
          ) : null}
        </span>

        <span className="shrink-0 text-right">
          {totals.lineCount > 0 ? (
            <span className="block text-xs font-bold tabular-nums text-[var(--content-primary)]">
              {formatCurrencyRaw(totals.valueTotal)}
            </span>
          ) : null}
          <span className="mt-0.5 block text-[10px] font-medium text-[var(--content-quaternary)] group-hover:text-[var(--content-tertiary)]">
            {expanded ? 'Hide lines' : 'Show lines'}
          </span>
        </span>
      </button>

      {expanded ? (
        <div id={panelId} className="border-t border-[var(--border-faint)] px-3 pb-3 pt-2">
          {hasWarnings ? (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-2.5 py-2 text-[10px] font-semibold leading-snug text-[var(--content-warning-on-light)]">
              <Warning size={14} weight="fill" className="mt-px shrink-0" aria-hidden />
              <span>
                {warningBrief}
                {' — verify rates in Busy before saving'}
              </span>
            </p>
          ) : null}

          {rows.length > 0 ? (
            <div className="grid gap-0.5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-2 px-1 text-[10px] font-bold uppercase tracking-wide text-[var(--content-tertiary)]">
                <span>Item</span>
                <span>Qty</span>
                <span>Unit</span>
                <span>MRP</span>
                <span>Status</span>
              </div>
              {rows.map((row) => (
                <div
                  key={row.item.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-center gap-2 rounded-md px-1 py-0.5 text-[11px] even:bg-[var(--bg-tertiary)]"
                >
                  <span className="min-w-0 truncate font-medium text-[var(--content-primary)]" title={row.pasteName}>
                    {row.pasteName}
                  </span>
                  <span className="whitespace-nowrap tabular-nums text-[var(--content-secondary)]">
                    {row.qty}
                  </span>
                  <span className="whitespace-nowrap text-[var(--content-secondary)]">
                    {row.unitLabel}
                  </span>
                  <span className="whitespace-nowrap tabular-nums font-semibold text-[var(--content-primary)]">
                    {formatRoundedRs(row.pasteMrp)}
                  </span>
                  <span className="whitespace-nowrap rounded-full bg-[var(--bg-primary)] px-2 py-0.5 font-semibold text-[var(--content-secondary)]">
                    {row.status}
                  </span>
                </div>
              ))}
            </div>
          ) : unresolvedCount > 0 ? (
            <p className="text-[11px] font-semibold text-[var(--content-warning-on-light)]">
              Resolve flagged lines before finalising.
            </p>
          ) : null}

          {pickerOosRows.length > 0 ? (
            <div className="mt-3 rounded-lg border border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] px-2.5 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--content-negative)]">
                Picker out of stock — not billed
              </p>
              <p className="mt-0.5 text-[10px] font-medium text-[var(--content-secondary)]">
                {pickerOosRows.length} item{pickerOosRows.length === 1 ? '' : 's'} · {pickerOosQty}{' '}
                pcs skipped
              </p>
              <div className="mt-2 grid gap-0.5">
                {pickerOosRows.map((row) => (
                  <div
                    key={row.item.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-[11px]"
                  >
                    <span
                      className="min-w-0 truncate font-medium text-[var(--content-primary)]"
                      title={row.productName}
                    >
                      {row.productName}
                    </span>
                    <span className="whitespace-nowrap tabular-nums font-semibold text-[var(--content-negative)]">
                      {row.qty}
                    </span>
                    <span className="whitespace-nowrap rounded-full bg-white/70 px-2 py-0.5 font-semibold text-[var(--content-negative)]">
                      {row.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
