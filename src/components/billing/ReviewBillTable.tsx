import { useMemo, useState } from 'react';
import {
  CaretDown,
  CaretRight,
  Check,
  Copy,
  PencilSimple,
  Trash,
  Warning,
} from '@phosphor-icons/react';
import {
  billableQtyForTotal,
  deriveBillLineFulfillment,
  summarizeBillFulfillment,
} from '../../lib/billing/billLineFulfillment';
import { busyEntryLineNature } from '../../lib/billing/busyEntryLineNature';
import { BusyEntryWorkHeader } from './busyEntry/BusyEntryWorkHeader';
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
import { SalesUnitBadge } from '../shared/SalesUnitBadge';
import { effectiveSalesLineUnit } from '../../lib/salesUnit';
import { formatCurrencyRaw } from '../../utils/formatters';
import { CHANGE_REASON_OPTIONS } from '../../pages/billing/BillingDesk/types';
import {
  billLineChipClasses,
  reviewStatusChipClasses,
  type ReviewStatusTone,
} from '../../lib/billing/billLineRowStyle';
import type { BillSheetEdits } from '../../hooks/useBillSheetEdits';

function statusTone(row: ReviewTableRow): ReviewStatusTone {
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

function StatusPill({ row }: { row: ReviewTableRow }): React.JSX.Element {
  const { short } = reviewStatusLabel(row);
  const tone = statusTone(row);
  return (
    <span
      className={`inline-flex max-w-full items-center font-bold uppercase tracking-wide ${reviewStatusChipClasses(tone)}`}
      title={reviewStatusLabel(row).long}
    >
      {short}
    </span>
  );
}

function summaryChipClass(tone: ReviewStatusTone): string {
  return `ds-chip border font-semibold tabular-nums ${billLineChipClasses(
    tone === 'bill' ? 'green' : tone === 'foc' ? 'blue' : tone === 'po' || tone === 'warn' ? 'amber' : 'red',
  )}`;
}

function ReviewWorkHeader({
  billSheet,
  readOnly,
  onCopyForBusy,
}: {
  billSheet: BillSheetEdits;
  readOnly: boolean;
  onCopyForBusy?: () => void;
}): React.JSX.Element {
  const { visibleItems, pendingByItemId, edits } = billSheet;
  const fulfillment = summarizeBillFulfillment(visibleItems, pendingByItemId);

  const copyableItems = useMemo(
    () =>
      visibleItems.filter((item) => {
        const edit = edits[item.id];
        if (edit?.removed) return false;
        if (item.state === 'flagged' && edit?.resolution == null) return false;
        const pending =
          item.item_id != null ? pendingByItemId.get(item.item_id) ?? [] : [];
        return !deriveBillLineFulfillment(item, pending).excludeFromBusyBill;
      }),
    [visibleItems, pendingByItemId, edits],
  );

  const specialRateCount = copyableItems.filter(
    (item) => busyEntryLineNature(item) === 'special_rate',
  ).length;
  const focLineCount = copyableItems.filter(
    (item) => busyEntryLineNature(item) === 'foc',
  ).length;
  const pendingLineCount = visibleItems.filter((item) => {
    if (edits[item.id]?.removed) return false;
    const pending =
      item.item_id != null ? pendingByItemId.get(item.item_id) ?? [] : [];
    const f = deriveBillLineFulfillment(item, pending);
    return f.excludeFromBusyBill || f.qtySalesPo > 0 || f.qtyPickerOos > 0;
  }).length;

  const detailChips: React.ReactNode[] = [];
  if (fulfillment.busyBillLines > 0) {
    detailChips.push(
      <span key="bill-lines" className={summaryChipClass('bill')}>
        {fulfillment.busyBillLines} bill lines
      </span>,
    );
  }
  if (fulfillment.salesPoQty > 0) {
    detailChips.push(
      <span key="sales-po" className={summaryChipClass('po')}>
        {fulfillment.salesPoQty} sales PO
      </span>,
    );
  }
  if (fulfillment.pickerOosQty > 0) {
    detailChips.push(
      <span key="picker-oos" className={summaryChipClass('oos')}>
        {fulfillment.pickerOosQty} picker OOS
      </span>,
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border-2 border-[var(--border-opaque)] bg-[var(--bg-secondary)]">
      <BusyEntryWorkHeader
        billableCount={copyableItems.length}
        qtyTotal={fulfillment.billTodayQty}
        specialRateCount={specialRateCount}
        focCount={focLineCount}
        pendingCount={pendingLineCount}
        rightSlot={
          !readOnly && onCopyForBusy ? (
            <button
              type="button"
              onClick={onCopyForBusy}
              disabled={copyableItems.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--content-primary)] bg-[var(--content-primary)] px-3 font-ds-caption-size font-semibold text-[var(--bg-primary)] transition-colors hover:opacity-90 disabled:opacity-40"
              style={{ borderWidth: '0.5px' }}
            >
              <Copy size={14} />
              Copy for Busy
            </button>
          ) : null
        }
      />
      {detailChips.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-t border-[var(--border-faint)] px-4 py-2">
          {detailChips}
        </div>
      ) : null}
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
  const barClass: Record<ReviewTableGroupId, string> = {
    flagged:
      'bg-[var(--bg-warning-subtle)] border-[var(--border-warning)] text-[var(--content-warning-on-light)]',
    bill:
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
  readOnly = false,
}: {
  row: ReviewTableRow;
  onPriceChange: (price: number) => void;
  readOnly?: boolean;
}): React.JSX.Element {
  const { item, edit, fulfillment, quotedPrice } = row;
  const edited = edit.priceTouched || edit.resolution === 'manual_override';
  const qty = billableQtyForTotal(item, fulfillment);

  if (fulfillment.excludeFromBusyBill) {
    return <span className="text-sm font-semibold text-[var(--content-tertiary)]">—</span>;
  }

  if (readOnly) {
    return (
      <div>
        <p className="text-base font-bold tabular-nums text-[var(--content-primary)]">
          {fulfillment.role === 'foc' ? '₹0' : formatRoundedRs(edit.priceQuoted)}
        </p>
        {qty > 0 ? (
          <p className="text-[10px] font-medium tabular-nums text-[var(--content-secondary)]">
            × {qty} pcs
          </p>
        ) : null}
      </div>
    );
  }

  if (fulfillment.role === 'foc') {
    return (
      <div>
        <p className="text-base font-bold tabular-nums text-[var(--content-accent)]">₹0</p>
        <p className="font-ds-micro font-semibold uppercase text-[var(--content-accent)]">FOC rate</p>
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
            ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-primary)]'
            : 'border-[var(--border-opaque)] bg-white text-[var(--content-primary)]'
        }`}
      />
      {edited && quotedPrice !== edit.priceQuoted ? (
        <p className="flex items-center gap-1 font-ds-micro font-semibold text-[var(--content-warning-on-light)]">
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
            className="h-8 rounded-md px-2 font-ds-micro font-bold bg-[var(--bg-positive)] text-white hover:opacity-95"
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
            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border-2 border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] px-2 font-ds-micro font-bold text-[var(--content-negative)]"
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
      <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--content-positive)]">
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
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--content-tertiary)] hover:bg-[var(--bg-negative-subtle)] hover:text-[var(--content-negative)]"
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
          className="font-ds-micro font-bold text-[var(--content-negative)]"
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

function TableHeader({ readOnly = false }: { readOnly?: boolean }): React.JSX.Element {
  return (
    <thead>
      <tr className="border-b-2 border-[var(--border-opaque)] bg-[var(--bg-tertiary)] text-left font-ds-label-size font-bold uppercase tracking-wider text-[var(--content-secondary)]">
        <th className="px-3 py-3 w-[108px]">Status</th>
        <th className="px-2 py-3 w-10 text-center">#</th>
        <th className="px-3 py-3 min-w-[200px]">Product</th>
        <th className="px-3 py-3 min-w-[160px] hidden lg:table-cell">Notes</th>
        <th className="px-3 py-3 w-16 text-right">Qty</th>
        <th className="px-3 py-3 w-[5.5rem] text-right">Unit</th>
        <th className="px-3 py-3 w-[108px]">Rate</th>
        <th className="px-3 py-3 w-24 text-right">Line ₹</th>
        {!readOnly ? <th className="px-3 py-3 w-28 text-right">Actions</th> : null}
      </tr>
    </thead>
  );
}

function TableRow({
  row,
  billSheet,
  pendingRemoveId,
  readOnly = false,
}: {
  row: ReviewTableRow;
  billSheet: BillSheetEdits;
  pendingRemoveId: number | null;
  readOnly?: boolean;
}): React.JSX.Element {
  const { item, edit } = row;
  const { fulfillment, lineTotal, samePartAsPrevious } = row;
  const product = reviewProductLabel(row);
  const notes = reviewStatusLabel(row).long;
  const labelMrp = orderItemConfirmedMrp(item);
  const qty = fulfillment.excludeFromBusyBill
    ? fulfillment.qtySalesPo || fulfillment.qtyPickerOos || fulfillment.qtyOrdered
    : billableQtyForTotal(item, fulfillment);

  const rowBg = fulfillment.excludeFromBusyBill
    ? 'bg-[var(--bg-secondary)]/80'
    : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-row-hover)]';

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
          <p className="mb-1 font-ds-micro font-bold uppercase tracking-wide text-[var(--content-accent)]">
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
      <td className="px-3 py-3 align-top text-right">
        <SalesUnitBadge unit={effectiveSalesLineUnit(item, edit)} />
      </td>
      <td className="px-3 py-3 align-top">
        <RateCell
          row={row}
          readOnly={readOnly}
          onPriceChange={(p) => billSheet.updatePrice(item.id, p, item)}
        />
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
      {!readOnly ? (
        <td className="px-3 py-3 align-top text-right">
          <ActionsCell row={row} billSheet={billSheet} pendingRemoveId={pendingRemoveId} />
        </td>
      ) : null}
    </tr>
  );
}

function GroupTable({
  group,
  billSheet,
  collapsed,
  onToggle,
  readOnly = false,
}: {
  group: ReviewTableGroup;
  billSheet: BillSheetEdits;
  collapsed: boolean;
  onToggle: () => void;
  readOnly?: boolean;
}): React.JSX.Element {
  const { pendingRemoveId } = billSheet;

  return (
    <section className="overflow-hidden rounded-xl border-2 border-[var(--border-opaque)] bg-white shadow-sm">
      <GroupHeader group={group} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && group.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse">
            <TableHeader readOnly={readOnly} />
            <tbody>
              {group.rows.map((row) => (
                <TableRow
                  key={row.item.id}
                  row={row}
                  billSheet={billSheet}
                  pendingRemoveId={pendingRemoveId}
                  readOnly={readOnly}
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
  readOnly?: boolean;
  onCopyForBusy?: () => void;
}

export function ReviewBillTable({
  billSheet,
  readOnly = false,
  onCopyForBusy,
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
      <ReviewWorkHeader
        billSheet={billSheet}
        readOnly={readOnly}
        onCopyForBusy={onCopyForBusy}
      />

      {!readOnly && groups.find((g) => g.id === 'flagged') && unresolvedFlagged.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 py-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--content-warning-on-light)]">
            <Warning size={18} weight="fill" />
            Resolve {unresolvedFlagged.length} flagged line
            {unresolvedFlagged.length === 1 ? '' : 's'} before billing
          </div>
          <div className="flex flex-wrap gap-2">
            {unresolvedPriceCount >= 2 ? (
              <button
                type="button"
                onClick={acceptAllBoxPrices}
                className="h-8 rounded-md px-3 text-xs font-bold bg-[var(--bg-positive)] text-white hover:opacity-95"
              >
                {acceptAllLabel} ({unresolvedPriceCount})
              </button>
            ) : null}
            {unresolvedOosCount >= 2 ? (
              <button
                type="button"
                onClick={removeAllOos}
                className="h-8 rounded-md border-2 border-[var(--border-negative)] bg-[var(--bg-secondary)] px-3 text-xs font-bold text-[var(--content-negative)]"
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
          readOnly={readOnly}
        />
      ))}

      {!readOnly && showReasonDropdown ? (
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

      {!readOnly && resolvingFlags && unresolvedFlagged.length === 0 && flaggedItems.length > 0 ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--content-positive)]">
          <Check size={16} weight="bold" />
          All flagged lines resolved
        </p>
      ) : null}
    </div>
  );
}
