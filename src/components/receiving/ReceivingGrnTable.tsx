import { useState, type ReactElement } from 'react';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { deriveLineStatus, lineStatusLabel } from '../../lib/receiving/receivingWorkflow';
import { updateReceivingJobLineRatio } from '../../lib/receiving/receivingApi';
import { AliasChip } from '../shared/AliasChip';
import { ReceivingGrnLineCard } from './ReceivingGrnLineCard';
import type { Item, ItemPackDefinition } from '../../types';
import type { ReceivingJobLineRow, ReceivingJobRow } from '../../types/receiving';

function statusPillClass(status: ReturnType<typeof deriveLineStatus>): string {
  switch (status) {
    case 'blocked_unmapped':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100';
    case 'pending_labels':
      return 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100';
    case 'labels_done':
      return 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100';
    case 'ready_putaway':
      return 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100';
    case 'putaway_done':
      return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100';
    default:
      return 'bg-[var(--bg-secondary)] text-[var(--content-secondary)]';
  }
}

export function ReceivingGrnTable({
  job,
  jobId,
  lines,
  items,
  packByBusy,
  platesByLineId,
  userId,
  userName,
  onUpdated,
  singleExpand = true,
}: {
  job: ReceivingJobRow;
  jobId: number;
  lines: ReceivingJobLineRow[];
  items: Item[];
  packByBusy: Map<number, ItemPackDefinition>;
  platesByLineId: Map<number, { receiving_lp_state?: string | null; receiving_putaway_ea_remaining?: number | null }[]>;
  userId: number | null;
  userName: string | null;
  onUpdated: () => void;
  singleExpand?: boolean;
}): ReactElement {
  const [expandedId, setExpandedId] = useState<number | null>(
    lines.length === 1 ? lines[0]?.id ?? null : null,
  );

  const toggleExpand = (id: number) => {
    setExpandedId((prev) => {
      if (prev === id) return null;
      return singleExpand ? id : id;
    });
  };

  if (lines.length === 0) {
    return <p className="text-sm text-[var(--content-tertiary)]">No GRN lines yet.</p>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)]">
      <div className="hidden grid-cols-[2.5rem_1fr_5rem_4.5rem] gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--content-tertiary)] sm:grid">
        <span>Ln</span>
        <span>SKU</span>
        <span className="text-right">PO pcs</span>
        <span className="text-right">Status</span>
      </div>
      {lines.map((line) => {
        const plates = platesByLineId.get(line.id) ?? [];
        const status = deriveLineStatus(job, line, plates);
        const expanded = expandedId === line.id;
        const catalogItem = items.find((i) => Number(i.busy_code) === Number(line.busy_code)) ?? null;
        const alias1 = catalogItem?.alias1?.trim() ?? '';

        return (
          <div key={line.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
            <button
              type="button"
              className="flex w-full min-h-12 items-start gap-2 px-3 py-3 text-left hover:bg-[var(--bg-secondary)]/60 sm:grid sm:grid-cols-[2.5rem_1fr_5rem_4.5rem] sm:items-center"
              onClick={() => toggleExpand(line.id)}
            >
              <span className="mt-0.5 shrink-0 text-[var(--content-tertiary)]">
                {expanded ? <CaretDown size={18} /> : <CaretRight size={18} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-mono text-xs font-bold text-[var(--content-accent)]">
                  {line.line_no}
                </span>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold">{line.busy_code}</span>
                  {alias1 ? <AliasChip label="Alias 1" value={alias1} tone="primary" /> : null}
                </div>
                <span className="mt-0.5 block truncate text-sm text-[var(--content-primary)]">
                  {line.sku_description_snapshot}
                </span>
                <span className="mt-1 block text-[11px] text-[var(--content-tertiary)] sm:hidden">
                  Lot {line.lot_no}
                  {line.po_qty_expected_ea != null ? ` · PO ${line.po_qty_expected_ea} pcs` : ''}
                </span>
              </span>
              <span className="hidden text-right font-mono text-xs sm:block">
                {line.po_qty_expected_ea != null ? line.po_qty_expected_ea : '—'}
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusPillClass(status)}`}
              >
                {lineStatusLabel(status)}
              </span>
            </button>
            {expanded ? (
              <div className="sm:pl-8">
                <div className="mb-2 flex flex-wrap items-center gap-2 px-3 sm:px-4">
                  <label className="text-xs font-semibold text-[var(--content-tertiary)]">
                    Lot
                    <input
                      key={`lot-${line.id}-${line.lot_no}`}
                      defaultValue={line.lot_no}
                      className="ml-2 min-h-9 w-36 rounded-lg border border-[var(--border-subtle)] px-2 font-mono text-sm"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== line.lot_no) {
                          void updateReceivingJobLineRatio(line.id, { lot_no: v }).then(() => onUpdated());
                        }
                      }}
                    />
                  </label>
                </div>
                <ReceivingGrnLineCard
                  line={line}
                  job={job}
                  jobId={jobId}
                  catalogItem={catalogItem}
                  packDef={packByBusy.get(Number(line.busy_code))}
                  userId={userId}
                  userName={userName}
                  onUpdated={onUpdated}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
