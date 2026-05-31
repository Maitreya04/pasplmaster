import { useMemo, useState } from 'react';
import {
  CaretDown,
  CaretRight,
  Check,
  PencilSimple,
  Trash,
  Warning,
} from '@phosphor-icons/react';
import {
  billableQtyForTotal,
  summarizeBillFulfillment,
} from '../../lib/billing/billLineFulfillment';
import { deskLineFlagKind } from '../../lib/billing/deskLineFlagKind';
import { resolvedLabelPriceForBilling } from '../../lib/billing/labelMrpFlag';
import {
  BILLING_ACCEPT_LABEL,
  BILLING_KEEP_QUOTED,
  BILLING_LABEL_CHIP,
  formatRoundedRs,
} from '../../lib/billing/mrpWorkflowCopy';
import {
  buildReviewBillTableGroups,
  reviewProductLabel,
  reviewStatusLabel,
  type ReviewTableGroup,
  type ReviewTableGroupId,
  type ReviewTableRow,
} from '../../lib/billing/reviewBillTableRows';
import { orderItemConfirmedMrp } from '../../lib/billing/orderItemSplitGroups';
import { formatCurrencyRaw } from '../../utils/formatters';
import { CHANGE_REASON_OPTIONS } from '../../pages/billing/BillingDesk/types';
import type { BillSheetEdits } from '../../hooks/useBillSheetEdits';

type StatusTone = 'bill' | 'foc' | 'po' | 'oos' | 'warn' | 'flag';

function statusTone(row: ReviewTableRow): StatusTone {
  const flagKind = deskLineFlagKind(row.item.flag_reason);
  if (row.item.state === 'flagged' && flagKind === 'price') return 'flag';
  if (row.item.state === 'flagged' && flagKind === 'oos') return 'oos';
  switch (row.fulfillment.role) {
    case 'foc':
      return 'foc';
    case 'sales_po':
      return 'po';
    case 'picker_oos':
    case 'billing_oos':
      return 'oos';
    case 'mixed':
      return 'warn';
    default:
      return 'bill';
  }
}

const STATUS_PILL: Record<StatusTone, string> = {
  bill: 'bg-emerald-600 text-white',
  foc: 'bg-violet-600 text-white',
  po: 'bg-amber-500 text-amber-950',
  oos: 'bg-red-600 text-white',
  warn: 'bg-amber-100 text-amber-900 ring-1 ring-amber-400',
  flag: 'bg-sky-600 text-white',
};

function StatusPill({ row }: { row: ReviewTableRow }): React.JSX.Element {
  const { short } = reviewStatusLabel(row);
  const tone = statusTone(row);
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${STATUS_PILL[tone]}`}
      title={reviewStatusLabel(row).long}
    >
      {short}
    </span>
  );
}

function ReviewToolbar({
  billSheet,
}: {
  billSheet: BillSheetEdits;
}): React.JSX.Element {
  const { visibleItems, pendingByItemId, total } = billSheet;
  const t = summarizeBillFulfillment(visibleItems, pendingByItemId);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border-2 border-[var(--border-opaque)] bg-[var(--bg-secondary)] px-4 py-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-[var(--content-secondary)]">
          Busy invoice total
        </p>
        <p className="text-2xl font-bold tabular-nums text-[var(--content-primary)]">
          {formatCurrencyRaw(total)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">
          {t.busyBillLines} bill lines
        </span>
        {t.focQty > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white">
            {t.focQty} FOC pcs
          </span>
        ) : null}
        {t.salesPoQty > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-amber-950">
            {t.salesPoQty} sales PO
          </span>
        ) : null}
        {t.pickerOosQty > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white">
            {t.pickerOosQty} picker OOS
          </span>
        ) : null}
      </div>
    </div>
  );
}

function GroupHeader({
  group,
  collapsed,
  onToggle,
}: {
  group: ReviewTableGroup;
  collapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const barClass = {
    flagged: 'bg-amber-100 border-amber-300 text-amber-950',
    bill: 'bg-emerald-50 border-emerald-300 text-emerald-950',
    skip: 'bg-[var(--bg-tertiary)] border-[var(--border-opaque)] text-[var(--content-primary)]',
  }[group.id];

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-3 border-b-2 px-4 py-3 text-left ${barClass}`}
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
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums">
          {group.lineCount} row{group.lineCount === 1 ? '' : 's'}
        </p>
        {group.id === 'bill' ? (
          <p className="text-xs font-semibold tabular-nums opacity-80">
            {formatCurrencyRaw(group.subtotal)}
          </p>
        ) : null}
      </div>
    </button>
  );
}

function RateCell({
  row,
  onPriceChange,
}: {
  row: ReviewTableRow;
  onPriceChange: (price: number) => void;
}): React.JSX.Element {
  const { item, edit, fulfillment, quotedPrice } = row;
  const edited = edit.priceTouched || edit.resolution === 'manual_override';
  const qty = billableQtyForTotal(item, fulfillment);

  if (fulfillment.excludeFromBusyBill) {
    return <span className="text-sm font-semibold text-[var(--content-tertiary)]">—</span>;
  }

  if (fulfillment.role === 'foc') {
    return (
      <div>
        <p className="text-base font-bold tabular-nums text-violet-700">₹0</p>
        <p className="text-[10px] font-semibold uppercase text-violet-600">FOC rate</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <input
        type="number"
        inputMode="decimal"
        aria-label="Bill rate"
        value={edit.priceQuoted}
        onChange={(e) => onPriceChange(parseFloat(e.target.value.replace(/,/g, '')) || 0)}
        className={`w-full min-h-10 rounded-lg border-2 px-2.5 text-base font-bold tabular-nums ${
          edited
            ? 'border-amber-400 bg-amber-50 text-[var(--content-primary)]'
            : 'border-[var(--border-opaque)] bg-white text-[var(--content-primary)]'
        }`}
      />
      {edited && quotedPrice !== edit.priceQuoted ? (
        <p className="flex items-center gap-1 text-[10px] font-semibold text-amber-700">
          <PencilSimple size={10} weight="bold" />
          Was {formatRoundedRs(quotedPrice)}
        </p>
      ) : null}
      {qty > 0 ? (
        <p className="text-[10px] font-medium tabular-nums text-[var(--content-secondary)]">
          × {qty} pcs
        </p>
      ) : null}
    </div>
  );
}

function ActionsCell({
  row,
  billSheet,
  pendingRemoveId,
}: {
  row: ReviewTableRow;
  billSheet: BillSheetEdits;
  pendingRemoveId: number | null;
}): React.JSX.Element {
  const { item, edit } = row;
  const {
    acceptBoxPrice,
    keepQuoted,
    removeFlaggedLine,
    undoRemove,
    undoRemoveId,
    setPendingRemoveId,
    patchEdit,
  } = billSheet;

  const kind = deskLineFlagKind(item.flag_reason);
  const labelMrp = orderItemConfirmedMrp(item);
  const labelPrice = resolvedLabelPriceForBilling(item, labelMrp);
  const isFlagged = item.state === 'flagged';
  const isResolved = edit.resolution != null;
  const isRemoved = edit.resolution === 'removed' || edit.removed;

  if (isFlagged && !isResolved) {
    return (
      <div className="flex flex-col gap-1">
        {kind === 'price' && labelPrice != null ? (
          <button
            type="button"
            onClick={() => acceptBoxPrice(item)}
            className="h-8 rounded-md bg-emerald-600 px-2 text-[10px] font-bold text-white hover:bg-emerald-700"
          >
            {BILLING_ACCEPT_LABEL} {formatRoundedRs(labelPrice)}
          </button>
        ) : null}
        {kind === 'price' || kind === 'oos' ? (
          <button
            type="button"
            onClick={() => keepQuoted(item)}
            className="h-8 rounded-md border-2 border-[var(--border-opaque)] bg-white px-2 text-[10px] font-bold text-[var(--content-primary)]"
          >
            {BILLING_KEEP_QUOTED}
          </button>
        ) : null}
        {kind === 'oos' ? (
          <button
            type="button"
            onClick={() => removeFlaggedLine(item)}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border-2 border-red-300 bg-red-50 px-2 text-[10px] font-bold text-red-700"
          >
            <Trash size={12} weight="bold" />
            Remove
          </button>
        ) : null}
      </div>
    );
  }

  if (isResolved && !isRemoved) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
        <Check size={14} weight="bold" />
        Done
      </span>
    );
  }

  if (row.fulfillment.excludeFromBusyBill) {
    return (
      <span className="text-xs font-semibold text-[var(--content-tertiary)]">Skip</span>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={() => setPendingRemoveId(item.id)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--content-tertiary)] hover:bg-red-50 hover:text-red-600"
        aria-label="Remove line"
      >
        <Trash size={16} />
      </button>
      {pendingRemoveId === item.id ? (
        <button
          type="button"
          onClick={() => {
            patchEdit(item.id, { removed: true });
            setPendingRemoveId(null);
          }}
          className="text-[10px] font-bold text-red-600"
        >
          Confirm
        </button>
      ) : null}
      {isRemoved && undoRemoveId === item.id ? (
        <button
          type="button"
          onClick={() => undoRemove(item.id)}
          className="text-[10px] font-bold text-[var(--content-accent)]"
        >
          Undo
        </button>
      ) : null}
    </div>
  );
}

function TableHeader(): React.JSX.Element {
  return (
    <thead>
      <tr className="border-b-2 border-[var(--border-opaque)] bg-[var(--bg-tertiary)] text-left text-[11px] font-bold uppercase tracking-wider text-[var(--content-secondary)]">
        <th className="px-3 py-3 w-[108px]">Status</th>
        <th className="px-2 py-3 w-10 text-center">#</th>
        <th className="px-3 py-3 min-w-[200px]">Product</th>
        <th className="px-3 py-3 min-w-[160px] hidden lg:table-cell">Notes</th>
        <th className="px-3 py-3 w-16 text-right">Qty</th>
        <th className="px-3 py-3 w-[108px]">Rate</th>
        <th className="px-3 py-3 w-24 text-right">Line ₹</th>
        <th className="px-3 py-3 w-28 text-right">Actions</th>
      </tr>
    </thead>
  );
}

function TableRow({
  row,
  billSheet,
  pendingRemoveId,
}: {
  row: ReviewTableRow;
  billSheet: BillSheetEdits;
  pendingRemoveId: number | null;
}): React.JSX.Element {
  const { item, fulfillment, lineTotal, samePartAsPrevious } = row;
  const product = reviewProductLabel(row);
  const notes = reviewStatusLabel(row).long;
  const labelMrp = orderItemConfirmedMrp(item);
  const qty = fulfillment.excludeFromBusyBill
    ? fulfillment.qtySalesPo || fulfillment.qtyPickerOos || fulfillment.qtyOrdered
    : billableQtyForTotal(item, fulfillment);

  const rowBg = fulfillment.excludeFromBusyBill
    ? 'bg-[var(--bg-secondary)]/80'
    : 'bg-white hover:bg-emerald-50/40';

  return (
    <tr className={`border-b border-[var(--border-subtle)] ${rowBg}`}>
      <td className="px-3 py-3 align-top">
        <StatusPill row={row} />
      </td>
      <td className="px-2 py-3 align-top text-center">
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-[var(--bg-tertiary)] text-xs font-bold tabular-nums text-[var(--content-primary)]">
          {row.lineNo}
        </span>
      </td>
      <td className="px-3 py-3 align-top min-w-0">
        {samePartAsPrevious ? (
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-violet-600">
            ↳ Same part · separate Busy line
          </p>
        ) : null}
        <p className="text-sm font-bold leading-snug text-[var(--content-primary)]">{product.name}</p>
        {product.pickCode ? (
          <p className="mt-1 font-mono text-xs font-semibold text-[var(--content-secondary)]">
            {product.pickCode}
            {product.altCode ? (
              <span className="text-[var(--content-tertiary)]"> · {product.altCode}</span>
            ) : null}
          </p>
        ) : null}
        <p className="mt-1 text-xs font-medium text-[var(--content-secondary)] lg:hidden">{notes}</p>
      </td>
      <td className="px-3 py-3 align-top hidden lg:table-cell">
        <p className="text-xs font-medium leading-relaxed text-[var(--content-secondary)]">{notes}</p>
        {labelMrp != null ? (
          <p className="mt-1 text-xs font-semibold text-[var(--content-primary)]">
            {BILLING_LABEL_CHIP(labelMrp)}
          </p>
        ) : null}
        {item.flag_notes?.trim() ? (
          <p className="mt-1 text-xs italic text-[var(--content-tertiary)]">{item.flag_notes.trim()}</p>
        ) : null}
      </td>
      <td className="px-3 py-3 align-top text-right">
        <span className="text-lg font-bold tabular-nums text-[var(--content-primary)]">{qty}</span>
        <p className="text-[10px] font-bold uppercase text-[var(--content-tertiary)]">
          {fulfillment.excludeFromBusyBill ? 'skip' : 'bill'}
        </p>
      </td>
      <td className="px-3 py-3 align-top">
        <RateCell row={row} onPriceChange={(p) => billSheet.updatePrice(item.id, p, item)} />
      </td>
      <td className="px-3 py-3 align-top text-right">
        {fulfillment.excludeFromBusyBill ? (
          <span className="text-sm font-semibold text-[var(--content-tertiary)]">—</span>
        ) : (
          <span className="text-base font-bold tabular-nums text-[var(--content-primary)]">
            {formatCurrencyRaw(lineTotal)}
          </span>
        )}
      </td>
      <td className="px-3 py-3 align-top text-right">
        <ActionsCell row={row} billSheet={billSheet} pendingRemoveId={pendingRemoveId} />
      </td>
    </tr>
  );
}

function GroupTable({
  group,
  billSheet,
  collapsed,
  onToggle,
}: {
  group: ReviewTableGroup;
  billSheet: BillSheetEdits;
  collapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const { pendingRemoveId } = billSheet;

  return (
    <section className="overflow-hidden rounded-xl border-2 border-[var(--border-opaque)] bg-white shadow-sm">
      <GroupHeader group={group} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && group.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse">
            <TableHeader />
            <tbody>
              {group.rows.map((row) => (
                <TableRow
                  key={row.item.id}
                  row={row}
                  billSheet={billSheet}
                  pendingRemoveId={pendingRemoveId}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!collapsed && group.rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm font-medium text-[var(--content-secondary)]">
          No rows in this group.
        </p>
      ) : null}
    </section>
  );
}

export interface ReviewBillTableProps {
  billSheet: BillSheetEdits;
}

export function ReviewBillTable({
  billSheet,
}: ReviewBillTableProps): React.JSX.Element {
  const {
    sortedLines,
    edits,
    pendingByItemId,
    flaggedItems,
    unresolvedFlagged,
    resolvingFlags,
    acceptAllBoxPrices,
    acceptAllLabel,
    unresolvedPriceCount,
    unresolvedOosCount,
    removeAllOos,
    showReasonDropdown,
    reason,
    setReason,
    setReasonTouched,
  } = billSheet;

  const flaggedItemIds = new Set(flaggedItems.map((i) => i.id));
  const displayLines = sortedLines.filter(
    (item) =>
      item.state !== 'flagged' ||
      flaggedItemIds.has(item.id) ||
      edits[item.id]?.removed,
  );

  const groups = useMemo(
    () =>
      buildReviewBillTableGroups(
        displayLines,
        sortedLines,
        edits,
        pendingByItemId,
        flaggedItemIds,
      ),
    [displayLines, sortedLines, edits, pendingByItemId, flaggedItemIds],
  );

  const [collapsed, setCollapsed] = useState<Partial<Record<ReviewTableGroupId, boolean>>>({
    skip: true,
  });

  const toggleGroup = (id: ReviewTableGroupId) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-4">
      <ReviewToolbar billSheet={billSheet} />

      {groups.find((g) => g.id === 'flagged') && unresolvedFlagged.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-950">
            <Warning size={18} weight="fill" />
            Resolve {unresolvedFlagged.length} flagged line
            {unresolvedFlagged.length === 1 ? '' : 's'} before billing
          </div>
          <div className="flex flex-wrap gap-2">
            {unresolvedPriceCount >= 2 ? (
              <button
                type="button"
                onClick={acceptAllBoxPrices}
                className="h-8 rounded-md bg-emerald-600 px-3 text-xs font-bold text-white"
              >
                {acceptAllLabel} ({unresolvedPriceCount})
              </button>
            ) : null}
            {unresolvedOosCount >= 2 ? (
              <button
                type="button"
                onClick={removeAllOos}
                className="h-8 rounded-md border-2 border-red-400 bg-white px-3 text-xs font-bold text-red-700"
              >
                Remove all OOS ({unresolvedOosCount})
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {groups.map((group) => (
        <GroupTable
          key={group.id}
          group={group}
          billSheet={billSheet}
          collapsed={collapsed[group.id] ?? false}
          onToggle={() => toggleGroup(group.id)}
        />
      ))}

      {showReasonDropdown ? (
        <div className="rounded-xl border-2 border-[var(--border-opaque)] bg-[var(--bg-secondary)] p-4">
          <label
            htmlFor="review-change-reason"
            className="text-xs font-bold uppercase tracking-wide text-[var(--content-secondary)]"
          >
            Reason for changes
          </label>
          <select
            id="review-change-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as typeof reason);
              setReasonTouched(true);
            }}
            className="mt-2 w-full min-h-11 rounded-lg border-2 border-[var(--border-opaque)] bg-white px-3 text-sm font-medium"
          >
            {CHANGE_REASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {resolvingFlags && unresolvedFlagged.length === 0 && flaggedItems.length > 0 ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <Check size={16} weight="bold" />
          All flagged lines resolved
        </p>
      ) : null}
    </div>
  );
}
