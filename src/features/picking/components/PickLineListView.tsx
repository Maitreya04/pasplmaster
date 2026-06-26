import {
  ArrowRight,
  CheckCircle,
  Circle,
  Flag,
  MapPin,
  Minus,
} from '@phosphor-icons/react';
import { UomBadge } from '../../../components/picking/UomBadge';
import {
  formatPickLineTotalPrice,
  groupPickLinesByRack,
  truncatePickDescription,
  type PickLineListEntry,
} from '../../../lib/picking/pickLineListDisplay';
import { normalizeUom } from '../../../lib/picking/pickerMicrocopy';

export interface PickLineListViewProps {
  rows: PickLineListEntry[];
  currentItemId: number | null;
  doneCount: number;
  totalCount: number;
  onSelectLine: (itemId: number) => void;
  onResumeCurrent: () => void;
  resumeLabel?: string;
}

function StatusDot({ status }: { status: PickLineListEntry['status'] }): React.JSX.Element {
  switch (status) {
    case 'picked':
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-positive-subtle)] ring-1 ring-[var(--border-positive)]">
          <CheckCircle size={12} weight="fill" className="text-[var(--content-positive)]" />
        </span>
      );
    case 'flagged':
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-negative-subtle)] ring-1 ring-[var(--border-negative)]">
          <Flag size={11} weight="fill" className="text-[var(--content-negative)]" />
        </span>
      );
    case 'partial':
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-warning-subtle)] ring-1 ring-[var(--border-warning)]">
          <Minus size={11} weight="bold" className="text-[var(--content-warning-on-light)]" />
        </span>
      );
    case 'now':
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--bg-accent-subtle)] ring-1 ring-[var(--role-primary)]">
          <MapPin size={11} weight="fill" className="text-[var(--role-primary)]" />
        </span>
      );
    default:
      return (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--border-opaque)] bg-[var(--bg-primary)]">
          <Circle size={9} weight="regular" className="text-[var(--content-quaternary)]" />
        </span>
      );
  }
}

function qtyLabel(row: PickLineListEntry): string {
  if (row.status === 'flagged') return 'Flag';
  if (row.status === 'picked') return 'Done';
  if (row.status === 'partial' && row.pickedQty != null) {
    return `${row.pickedQty}/${row.targetQty}`;
  }
  return String(row.targetQty);
}

function PickLineListRow({
  row,
  isActive,
  showRackColumn,
  onSelect,
}: {
  row: PickLineListEntry;
  isActive: boolean;
  showRackColumn: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const priceLabel = formatPickLineTotalPrice(row.targetQty, row.unitPrice);
  const uomNorm = normalizeUom(row.uom);

  return (
    <li className="border-b border-[var(--border-faint)] last:border-b-0">
      <button
        type="button"
        onClick={onSelect}
        className={`pick-line-list-row flex w-full min-h-[44px] items-center gap-2 px-3 py-1.5 text-left pick-pressable ${
          isActive
            ? 'bg-[color-mix(in_srgb,var(--role-primary)_12%,var(--bg-secondary))]'
            : 'active:bg-[var(--bg-tertiary)]'
        }`}
      >
        {showRackColumn ? (
          <span className="w-12 shrink-0 truncate font-mono text-[10px] font-bold tabular-nums text-[var(--content-tertiary)]">
            {row.rackNo ?? '—'}
          </span>
        ) : null}

        <StatusDot status={row.status} />

        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-bold text-[var(--content-primary)]">
            {row.partCode}
          </p>
          <p className="truncate text-[10px] leading-tight text-[var(--content-tertiary)]">
            {truncatePickDescription(row.itemName)}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-1.5">
            <span
              className={`font-mono text-xs font-bold tabular-nums ${
                row.status === 'picked'
                  ? 'text-[var(--content-positive)]'
                  : row.status === 'partial'
                    ? 'text-[var(--content-warning-on-light)]'
                    : 'text-[var(--content-primary)]'
              }`}
            >
              {qtyLabel(row)}
            </span>
            <UomBadge uom={uomNorm} />
          </div>
          {priceLabel ? (
            <p className="mt-0.5 font-mono text-[9px] tabular-nums text-[var(--content-quaternary)]">
              {priceLabel}
            </p>
          ) : null}
        </div>
      </button>
    </li>
  );
}

export function PickLineListView({
  rows,
  currentItemId,
  doneCount,
  totalCount,
  onSelectLine,
  onResumeCurrent,
  resumeLabel,
}: PickLineListViewProps): React.JSX.Element {
  const groups = groupPickLinesByRack(rows);
  const useRackGrouping = groups.some((g) => g.rows.length > 1);
  const currentRow = rows.find((r) => r.itemId === currentItemId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-[var(--border-faint)] px-3 py-1.5">
        <div
          className={`grid items-center gap-2 text-[9px] font-bold uppercase tracking-wider text-[var(--content-quaternary)] ${
            useRackGrouping ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[3rem_1fr_auto_auto]'
          }`}
        >
          {!useRackGrouping ? <span>Rack</span> : null}
          <span>Part</span>
          <span className="text-right">Qty</span>
          <span className="w-10 text-center">Unit</span>
        </div>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {groups.map((group) => (
          <li key={group.rackKey}>
            {useRackGrouping ? (
              <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-[var(--border-faint)] bg-[var(--bg-secondary)] px-3 py-1.5">
                <span className="font-mono text-xs font-extrabold tabular-nums text-[var(--role-primary)]">
                  {group.rackLabel}
                </span>
                <span className="h-px flex-1 bg-[var(--border-faint)]" aria-hidden />
                <span className="text-[9px] font-semibold tabular-nums text-[var(--content-quaternary)]">
                  {group.rows.length} line{group.rows.length === 1 ? '' : 's'}
                </span>
              </div>
            ) : null}
            <ul>
              {group.rows.map((row) => (
                <PickLineListRow
                  key={row.itemId}
                  row={row}
                  isActive={row.itemId === currentItemId}
                  showRackColumn={!useRackGrouping}
                  onSelect={() => onSelectLine(row.itemId)}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3">
        <p className="mb-2 text-center text-[10px] font-semibold tabular-nums text-[var(--content-tertiary)]">
          {doneCount} / {totalCount} done
        </p>
        {currentRow && resumeLabel ? (
          <button
            type="button"
            onClick={onResumeCurrent}
            className="flex w-full min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--bg-inverse-primary)] font-ds-body-size font-extrabold text-white pick-pressable"
          >
            <ArrowRight size={18} weight="bold" />
            {resumeLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
