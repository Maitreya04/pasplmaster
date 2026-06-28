import {
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
}

function StatusDot({ status }: { status: PickLineListEntry['status'] }): React.JSX.Element {
  switch (status) {
    case 'picked':
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-positive-subtle)] ring-1 ring-[var(--border-positive)]">
          <CheckCircle size={14} weight="fill" className="text-[var(--content-positive)]" />
        </span>
      );
    case 'flagged':
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-negative-subtle)] ring-1 ring-[var(--border-negative)]">
          <Flag size={12} weight="fill" className="text-[var(--content-negative)]" />
        </span>
      );
    case 'partial':
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-warning-subtle)] ring-1 ring-[var(--border-warning)]">
          <Minus size={12} weight="bold" className="text-[var(--content-warning-on-light)]" />
        </span>
      );
    case 'now':
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-accent-subtle)] ring-2 ring-[var(--role-primary)]">
          <MapPin size={12} weight="fill" className="text-[var(--role-primary)]" />
        </span>
      );
    default:
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--border-opaque)] bg-[var(--bg-primary)]">
          <Circle size={10} weight="regular" className="text-[var(--content-quaternary)]" />
        </span>
      );
  }
}

function qtyLabel(row: PickLineListEntry): string {
  if (row.status === 'flagged') return 'Flag';
  if (row.status === 'picked') {
    return `${row.targetQty}/${row.targetQty}`;
  }
  if (row.status === 'partial' && row.pickedQty != null) {
    return `${row.pickedQty}/${row.targetQty}`;
  }
  if (row.status === 'now' && row.pickedQty != null && row.pickedQty > 0) {
    return `${row.pickedQty}/${row.targetQty}`;
  }
  return `${row.targetQty}`;
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
        className={`pick-line-list-row flex w-full min-h-[52px] items-center gap-2.5 px-3 py-2 text-left pick-pressable ${
          isActive
            ? 'bg-[color-mix(in_srgb,var(--role-primary)_14%,var(--bg-secondary))] ring-1 ring-inset ring-[var(--role-primary)]/25'
            : 'active:bg-[var(--bg-tertiary)]'
        }`}
      >
        {showRackColumn ? (
          <span className="w-14 shrink-0 truncate font-mono text-xs font-bold tabular-nums text-[var(--content-tertiary)]">
            {row.rackNo ?? '—'}
          </span>
        ) : null}

        <StatusDot status={isActive ? 'now' : row.status} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-mono text-sm font-bold text-[var(--content-primary)]">
              {row.partCode}
            </p>
            {isActive ? (
              <span className="shrink-0 rounded-full bg-[var(--role-primary)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                Here
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs leading-tight text-[var(--content-tertiary)]">
            {truncatePickDescription(row.itemName)}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-1.5">
            <span
              className={`font-mono text-sm font-bold tabular-nums ${
                row.status === 'picked'
                  ? 'text-[var(--content-positive)]'
                  : row.status === 'partial' || (isActive && row.pickedQty)
                    ? 'text-[var(--content-warning-on-light)]'
                    : 'text-[var(--content-primary)]'
              }`}
            >
              {qtyLabel(row)}
            </span>
            <UomBadge uom={uomNorm} />
          </div>
          {priceLabel ? (
            <p className="mt-0.5 font-mono text-[10px] tabular-nums text-[var(--content-quaternary)]">
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
}: PickLineListViewProps): React.JSX.Element {
  const groups = groupPickLinesByRack(rows);
  const useRackGrouping = groups.some((g) => g.rows.length > 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-[var(--border-faint)] px-3 py-2">
        <div
          className={`grid items-center gap-2 font-ds-micro font-bold uppercase tracking-wider text-[var(--content-quaternary)] ${
            useRackGrouping ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[3.5rem_1fr_auto_auto]'
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
              <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-[var(--border-faint)] bg-[var(--bg-secondary)] px-3 py-2">
                <span className="font-mono text-sm font-extrabold tabular-nums text-[var(--role-primary)]">
                  {group.rackLabel}
                </span>
                <span className="h-px flex-1 bg-[var(--border-faint)]" aria-hidden />
                <span className="font-ds-micro font-semibold tabular-nums text-[var(--content-quaternary)]">
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

      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-2.5">
        <p className="text-center font-ds-caption-size font-semibold tabular-nums text-[var(--content-secondary)]">
          Tap any line to jump · {doneCount} of {totalCount} done
        </p>
      </div>
    </div>
  );
}
