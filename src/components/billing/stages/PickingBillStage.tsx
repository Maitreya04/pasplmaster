import { useMemo, useState } from 'react';
import {
  CaretDown,
  CaretRight,
  Package,
  Warning,
} from '@phosphor-icons/react';
import { computePickLineProgress, type PickLineProgress } from '../../../lib/cartSupply';
import {
  formatDeskFlagSummarySubtitle,
  summarizeDeskFlags,
} from '../../../lib/billing/deskLineFlagKind';
import {
  buildPickingBillTableGroups,
  pickingProductLabel,
  pickingRowNotes,
  pickingStatusLabel,
  type PickingTableGroup,
  type PickingTableGroupId,
  type PickingTableRow,
} from '../../../lib/billing/pickingBillTableRows';
import { summarizeBillFulfillment } from '../../../lib/billing/billLineFulfillment';
import { derivePickingMonitorPresentation } from '../../../lib/billing/pickingMonitorPresentation';
import { reviewStatusChipClasses } from '../../../lib/billing/billLineRowStyle';
import { SalesUnitBadge } from '../../shared/SalesUnitBadge';
import { effectiveSalesLineUnit } from '../../../lib/salesUnit';
import { formatCurrencyRaw } from '../../../utils/formatters';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import type { OrderItem, OrderWithItems, PendingItem } from '../../../types';

interface PickingBillStageProps {
  order: DeskOrderRow;
  orderDetail: OrderWithItems;
  items: OrderItem[];
  pendingByItemId: Map<number, PendingItem[]>;
}

function pickProgressFromItems(items: OrderItem[]): PickLineProgress {
  return computePickLineProgress(
    items.map((item) => ({
      state: item.state,
      qty_requested: item.qty_requested,
      qty_shippable: item.qty_shippable,
      qty_po: item.qty_po,
      qty_approved: item.qty_approved,
      split_from_id: item.split_from_id,
    })),
  );
}

function progressPct(
  progress: PickLineProgress,
  deskStatus: DeskOrderRow['deskStatus'],
): number {
  if (deskStatus === 'checking') return 100;
  if (progress.total === 0) return 0;
  return Math.round((progress.done / progress.total) * 100);
}

function progressBarColor(
  ratio: number,
  order: DeskOrderRow,
  flagged: number,
  warningTint: boolean,
): string {
  if (order.deskStatus === 'checking') return 'var(--bg-positive)';
  if (order.pickingClaimStale || (warningTint && ratio === 0)) return 'var(--bg-warning)';
  if (flagged > 0) return 'var(--bg-warning)';
  if (ratio >= 0.8) return 'var(--bg-positive)';
  return 'var(--role-primary)';
}

function PickingProgressHeader({
  order,
  orderDetail,
  progress,
  items,
  pendingByItemId,
  monitor,
}: {
  order: DeskOrderRow;
  orderDetail: OrderWithItems;
  progress: PickLineProgress;
  items: OrderItem[];
  pendingByItemId: Map<number, PendingItem[]>;
  monitor: ReturnType<typeof derivePickingMonitorPresentation>;
}): React.JSX.Element {
  const fulfillment = summarizeBillFulfillment(items, pendingByItemId);
  const ratio = progress.total > 0 ? progress.done / progress.total : 0;
  const pickerFirst = orderDetail.picker_name?.split(/\s+/)[0] ?? orderDetail.picker_name ?? null;
  const pct = progressPct(progress, order.deskStatus);
  const statusLine = monitor.progressStatusLine(progress, pickerFirst);

  return (
    <div className="overflow-hidden rounded-xl border-2 border-[var(--border-opaque)] bg-[var(--bg-secondary)]">
      <div className="px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-ds-micro font-semibold uppercase text-[var(--content-quaternary)]">
              Warehouse pick
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[28px] font-semibold leading-none tabular-nums text-[var(--content-primary)]">
                {pct}%
              </span>
              <span className="font-ds-caption-size font-medium text-[var(--content-secondary)]">
                {statusLine}
              </span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  background: progressBarColor(
                    ratio,
                    order,
                    progress.flagged,
                    monitor.progressWarningTint,
                  ),
                }}
              />
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2 self-end sm:self-start sm:pt-0.5">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-opaque)] bg-[var(--bg-primary)] px-2.5 font-ds-caption-size font-semibold tabular-nums text-[var(--content-primary)]">
              <Package size={14} weight="bold" className="text-[var(--role-content)]" />
              {progress.picked} picked
            </span>
            {progress.flagged > 0 ? (
              <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-2.5 font-ds-caption-size font-semibold tabular-nums text-[var(--content-warning-on-light)]">
                <Warning size={14} weight="fill" />
                {progress.flagged} flagged
              </span>
            ) : null}
            <span className="inline-flex h-7 items-center rounded-md border border-[var(--border-opaque)] bg-[var(--bg-primary)] px-2.5 font-ds-caption-size font-semibold tabular-nums text-[var(--content-tertiary)]">
              {fulfillment.busyBillLines} bill lines
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ row }: { row: PickingTableRow }): React.JSX.Element {
  const { short, tone } = pickingStatusLabel(row);
  const toneClass =
    tone === 'flag'
      ? reviewStatusChipClasses('flag')
      : tone === 'oos'
        ? reviewStatusChipClasses('oos')
        : tone === 'bill'
          ? reviewStatusChipClasses('bill')
          : tone === 'po'
            ? reviewStatusChipClasses('po')
            : tone === 'accent'
              ? 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border border-[var(--border-accent)]'
              : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)] border border-[var(--border-opaque)]';

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-md border px-1.5 py-0.5 font-ds-micro font-bold uppercase tracking-wide ${toneClass}`}
    >
      {short}
    </span>
  );
}

function GroupHeader({
  group,
  collapsed,
  onToggle,
}: {
  group: PickingTableGroup;
  collapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const barClass: Record<PickingTableGroupId, string> = {
    flagged:
      'bg-[var(--bg-warning-subtle)] border-[var(--border-warning)] text-[var(--content-warning-on-light)]',
    awaiting:
      'bg-[var(--bg-accent-subtle)] border-[var(--border-accent)] text-[var(--content-accent)]',
    picked:
      'bg-[var(--bg-positive-subtle)] border-[var(--border-positive)] text-[var(--content-positive)]',
    skip: 'bg-[var(--bg-tertiary)] border-[var(--border-opaque)] text-[var(--content-primary)]',
  };

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-3 border-b-2 px-4 py-3 text-left ${barClass[group.id]}`}
    >
      {collapsed ? (
        <CaretRight size={16} weight="bold" className="shrink-0 opacity-70" />
      ) : (
        <CaretDown size={16} weight="bold" className="shrink-0 opacity-70" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{group.title}</p>
        <p className="text-xs font-medium opacity-80">{group.hint}</p>
      </div>
      <p className="shrink-0 text-sm font-bold tabular-nums">
        {group.lineCount} row{group.lineCount === 1 ? '' : 's'}
      </p>
    </button>
  );
}

function PickingTableRowView({ row }: { row: PickingTableRow }): React.JSX.Element {
  const product = pickingProductLabel(row);
  const notes = pickingRowNotes(row);
  const qty = row.fulfillment.qtyBillToday || row.item.qty_requested;
  const accent =
    row.pickState === 'flagged'
      ? 'var(--border-warning)'
      : row.pickState === 'picked'
        ? 'var(--border-positive)'
        : row.pickState === 'awaiting'
          ? 'var(--border-accent)'
          : null;

  return (
    <tr
      className="border-b border-[var(--border-faint)]"
      style={
        accent
          ? {
              boxShadow: `inset 3px 0 0 0 ${accent}`,
            }
          : undefined
      }
    >
      <td className="px-3 py-2.5 align-top text-right">
        <span className="font-ds-caption-size font-semibold tabular-nums text-[var(--content-quaternary)]">
          {row.lineNo}
        </span>
      </td>
      <td className="px-3 py-2.5 align-top">
        <StatusPill row={row} />
      </td>
      <td className="px-3 py-2.5 align-top min-w-[200px]">
        <p className="text-sm font-semibold leading-snug text-[var(--content-primary)]">
          {product.name}
        </p>
        <p className="mt-0.5 font-mono text-xs text-[var(--content-secondary)]">{product.pickCode}</p>
      </td>
      <td className="px-3 py-2.5 align-top hidden md:table-cell">
        <p className="text-xs font-medium leading-relaxed text-[var(--content-secondary)]">{notes}</p>
      </td>
      <td className="px-3 py-2.5 align-top text-right">
        <span className="text-base font-bold tabular-nums text-[var(--content-primary)]">{qty}</span>
        <div className="mt-1 flex justify-end">
          <SalesUnitBadge unit={effectiveSalesLineUnit(row.item)} />
        </div>
      </td>
      <td className="px-3 py-2.5 align-top text-right">
        <span className="text-sm font-bold tabular-nums text-[var(--content-primary)]">
          {row.fulfillment.role === 'foc' ? '₹0' : formatCurrencyRaw(row.quotedPrice)}
        </span>
      </td>
      <td className="px-3 py-2.5 align-top text-right">
        <span className="text-sm font-bold tabular-nums text-[var(--content-primary)]">
          {row.fulfillment.excludeFromBusyBill ? '—' : formatCurrencyRaw(row.lineTotal)}
        </span>
      </td>
    </tr>
  );
}

function PickingGroupTable({
  group,
  collapsed,
  onToggle,
}: {
  group: PickingTableGroup;
  collapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-xl border-2 border-[var(--border-opaque)] bg-white shadow-sm">
      <GroupHeader group={group} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && group.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="border-b border-[var(--border-faint)] bg-[var(--bg-secondary)]">
                {['#', 'Status', 'Product', 'Notes', 'Qty', 'Rate', 'Line ₹'].map((label, i) => (
                  <th
                    key={label}
                    className={`px-3 py-2 font-ds-micro font-semibold uppercase text-[var(--content-quaternary)] ${
                      i >= 4 ? 'text-right' : 'text-left'
                    } ${label === 'Notes' ? 'hidden md:table-cell' : ''}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <PickingTableRowView key={row.item.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function PickingBillStage({
  order,
  orderDetail,
  items,
  pendingByItemId,
}: PickingBillStageProps): React.JSX.Element {
  const progress = useMemo(() => pickProgressFromItems(items), [items]);
  const groups = useMemo(
    () => buildPickingBillTableGroups(items, pendingByItemId),
    [items, pendingByItemId],
  );

  const flagSummary = useMemo(() => {
    const flagged = items.filter((i) => i.state === 'flagged');
    return summarizeDeskFlags(flagged.map((i) => i.flag_reason));
  }, [items]);

  const [collapsed, setCollapsed] = useState<Partial<Record<PickingTableGroupId, boolean>>>(() => {
    const initial: Partial<Record<PickingTableGroupId, boolean>> = {
      picked: true,
      skip: true,
    };
    if (progress.remaining === 0 && progress.done > 0) {
      initial.awaiting = true;
    }
    return initial;
  });

  const toggleGroup = (id: PickingTableGroupId) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const monitor = useMemo(
    () =>
      derivePickingMonitorPresentation({
        deskStatus: order.deskStatus,
        pickingClaimStale: order.pickingClaimStale,
        pickerName: orderDetail.picker_name,
        workflowStatus: orderDetail.workflow_status,
        progress,
      }),
    [order.deskStatus, order.pickingClaimStale, orderDetail.picker_name, orderDetail.workflow_status, progress],
  );

  return (
    <div className="space-y-4 p-2">
      {monitor.banner ? (
        <div className="flex items-start gap-2 rounded-lg border-2 border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 py-3">
          <Warning size={18} weight="fill" className="mt-0.5 shrink-0 text-[var(--content-warning-on-light)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--content-warning-on-light)]">
              {monitor.banner.title}
            </p>
            <p className="mt-0.5 text-xs font-medium text-[var(--content-warning-on-light)]/90">
              {monitor.banner.body}
            </p>
          </div>
        </div>
      ) : null}

      <PickingProgressHeader
        order={order}
        orderDetail={orderDetail}
        progress={progress}
        items={items}
        pendingByItemId={pendingByItemId}
        monitor={monitor}
      />

      {progress.flagged > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border-2 border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 py-3">
          <Warning size={18} weight="fill" className="mt-0.5 shrink-0 text-[var(--content-warning-on-light)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--content-warning-on-light)]">
              {progress.flagged} picker flag{progress.flagged === 1 ? '' : 's'} live
            </p>
            <p className="mt-0.5 text-xs font-medium text-[var(--content-warning-on-light)]/90">
              {formatDeskFlagSummarySubtitle(flagSummary) ||
                'Resolve each line after the pick completes'}
            </p>
          </div>
        </div>
      ) : null}

      {groups.map((group) => (
        <PickingGroupTable
          key={group.id}
          group={group}
          collapsed={collapsed[group.id] ?? (group.id === 'picked' || group.id === 'skip')}
          onToggle={() => toggleGroup(group.id)}
        />
      ))}

      {order.deskStatus === 'checking' ? (
        <p className="px-2 text-sm font-medium text-[var(--content-positive)]">
          Pick finished — this order will move to bill review shortly.
        </p>
      ) : (
        <p className="px-2 text-xs font-medium text-[var(--content-tertiary)]">
          Bill actions unlock when the warehouse pick completes. Use Re-assign on the card if you
          need to change picker.
        </p>
      )}
    </div>
  );
}
