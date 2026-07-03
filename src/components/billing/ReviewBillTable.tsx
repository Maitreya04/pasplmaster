import { useMemo, useState } from 'react';
import { CaretDown, CaretRight, Check, PencilSimple, Trash, Warning } from '@phosphor-icons/react';
import { QueueSectionHeader } from '../shared/QueueSectionHeader';
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
  type ReviewPartGroupMeta,
  type ReviewTableGroup,
  type ReviewTableGroupId,
  type ReviewTableRow,
} from '../../lib/billing/reviewBillTableRows';
import { orderItemConfirmedMrp } from '../../lib/billing/orderItemSplitGroups';
import { readPickMrpSnapshot } from '../../lib/billing/pickMrpBillingContext';
import { getBookPrice, getQuotedPrice, isSpecialRateItem } from '../../lib/specialPricing';
import { SalesUnitBadge } from '../shared/SalesUnitBadge';
import { effectiveSalesLineUnit } from '../../lib/salesUnit';
import { BillingFigure } from './shared/BillingFigure';
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
  if (row.item.scan_result?.isShortPick) return 'warn';
  if (row.item.scan_result?.isOverTarget) return 'warn';
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

function ReviewFulfillmentChips({ billSheet }: { billSheet: BillSheetEdits }): React.JSX.Element | null {
  const { visibleItems, pendingByItemId } = billSheet;
  const fulfillment = summarizeBillFulfillment(visibleItems, pendingByItemId);

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

  if (detailChips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border-faint)] bg-[var(--bg-primary)] px-3 py-2">
      {detailChips}
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
  if (group.id === 'bill') {
    return (
      <QueueSectionHeader
        label="Bill into Busy"
        count={group.lineCount}
        description="Rate × qty = line total"
        variant="divider"
        tone="info"
        rightSlot={
          group.subtotal > 0 ? (
            <BillingFigure value={group.subtotal} kind="currency-raw" size="sm" />
          ) : null
        }
      />
    );
  }

  const barClass: Record<ReviewTableGroupId, string> = {
    flagged:
      'bg-[var(--bg-warning-subtle)] border-[var(--border-warning)] text-[var(--content-warning-on-light)]',
    bill: '',
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
        <BillingFigure value={group.lineCount} kind="integer" size="sm" />
        <span className="text-xs font-medium opacity-80">
          {' '}
          row{group.lineCount === 1 ? '' : 's'}
        </span>
      </div>
    </button>
  );
}

function PartGroupBanner({ group }: { group: ReviewPartGroupMeta }): React.JSX.Element {
  return (
    <div className="review-part-group-banner">
      <span className="review-part-group-banner__ordered">
        {group.orderedQty} ordered
      </span>
      <span className="review-part-group-banner__split">
        → {group.size} Busy lines
      </span>
      {group.breakdown ? (
        <span className="review-part-group-banner__mix">{group.breakdown}</span>
      ) : null}
    </div>
  );
}

type RateReference = {
  id: 'order' | 'bill' | 'special' | 'label' | 'picker';
  label: string;
  value: number;
};

function rateReferences(row: ReviewTableRow): RateReference[] {
  const { item, edit } = row;
  const current = edit.priceQuoted;
  const quoted = getQuotedPrice(item) ?? 0;
  const book = getBookPrice(item);
  const isSpecial = isSpecialRateItem(item);
  const snapshot = readPickMrpSnapshot(item);
  const labelMrp = snapshot.labelMrp;
  const billingAtPick = snapshot.billingRateAtPick;
  const refs: RateReference[] = [];

  const pushUnique = (ref: RateReference): void => {
    if (!Number.isFinite(ref.value) || ref.value < 0) return;
    if (Math.round(ref.value) === Math.round(current)) return;
    if (refs.some((r) => Math.round(r.value) === Math.round(ref.value))) return;
    refs.push(ref);
  };

  if (isSpecial) {
    if (book != null) pushUnique({ id: 'bill', label: 'Bill', value: book });
    if (quoted > 0) pushUnique({ id: 'special', label: 'Special', value: quoted });
  } else {
    if (quoted > 0) pushUnique({ id: 'order', label: 'Order', value: quoted });
    if (book != null && book !== quoted) {
      pushUnique({ id: 'bill', label: 'Bill', value: book });
    }
  }
  if (labelMrp != null) {
    pushUnique({ id: 'label', label: 'Label', value: labelMrp });
  }
  if (billingAtPick != null) {
    pushUnique({ id: 'picker', label: 'At pick', value: billingAtPick });
  }

  return refs;
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
  const { edit, fulfillment, quotedPrice } = row;
  const edited = edit.priceTouched || edit.resolution === 'manual_override';
  const refs = rateReferences(row);

  if (fulfillment.excludeFromBusyBill) {
    return <span className="text-sm font-semibold text-[var(--content-tertiary)]">—</span>;
  }

  if (readOnly) {
    return (
      <div className="review-rate-cell">
        <BillingFigure
          value={fulfillment.role === 'foc' ? 0 : edit.priceQuoted}
          kind="currency-raw"
          size="md"
        />
      </div>
    );
  }

  if (fulfillment.role === 'foc') {
    return (
      <div className="review-rate-cell">
        <BillingFigure value={0} kind="currency-raw" size="md" className="text-[var(--content-accent)]" />
        <p className="font-ds-micro font-semibold uppercase text-[var(--content-accent)]">FOC rate</p>
      </div>
    );
  }

  return (
    <div className="review-rate-cell">
      <input
        type="number"
        inputMode="decimal"
        aria-label="Bill rate"
        value={edit.priceQuoted}
        onChange={(e) => onPriceChange(parseFloat(e.target.value.replace(/,/g, '')) || 0)}
        className={`review-rate-input billing-rate-input ${
          edited
            ? 'review-rate-input--edited'
            : ''
        }`}
      />
      {edited && quotedPrice !== edit.priceQuoted ? (
        <p className="review-rate-cell__edited-hint">
          <PencilSimple size={10} weight="bold" aria-hidden />
          Was {formatRoundedRs(quotedPrice)}
        </p>
      ) : null}
      {refs.length > 0 ? (
        <div className="review-rate-refs" role="group" aria-label="Swap bill rate">
          {refs.map((ref) => (
            <button
              key={ref.id}
              type="button"
              onClick={() => onPriceChange(ref.value)}
              className="review-rate-ref-chip"
              title={`Use ${ref.label.toLowerCase()} rate ${formatRoundedRs(ref.value)}`}
            >
              <span className="review-rate-ref-chip__label">{ref.label}</span>
              <span className="review-rate-ref-chip__value">{formatRoundedRs(ref.value)}</span>
            </button>
          ))}
        </div>
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
        <th className="px-1 py-3 w-8 text-center review-col-line-no">#</th>
        <th className="px-3 py-3 min-w-[200px]">Product</th>
        <th className="px-3 py-3 min-w-[160px] hidden lg:table-cell">Notes</th>
        <th className="px-3 py-3 billing-col-qty text-right">Qty</th>
        <th className="px-3 py-3 w-[5.5rem] text-right">Unit</th>
        <th className="px-3 py-3 billing-col-rate review-col-rate">Rate</th>
        <th className="px-3 py-3 billing-col-money text-right">Line ₹</th>
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
  const { fulfillment, lineTotal, partGroup } = row;
  const product = reviewProductLabel(row);
  const notes = reviewStatusLabel(row).long;
  const labelMrp = orderItemConfirmedMrp(item);
  const qty = fulfillment.excludeFromBusyBill
    ? fulfillment.qtySalesPo || fulfillment.qtyPickerOos || fulfillment.qtyOrdered
    : billableQtyForTotal(item, fulfillment);
  const isBatchContinuation = partGroup?.isContinuation === true;

  const rowBg = fulfillment.excludeFromBusyBill
    ? 'bg-[var(--bg-secondary)]/80'
    : isBatchContinuation
      ? 'bg-[var(--bg-primary)] hover:bg-[var(--bg-row-hover)] review-row--batch-cont'
      : 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-row-hover)]';

  return (
    <tr className={`border-b border-[var(--border-subtle)] ${rowBg}`}>
      <td className="px-3 py-3 align-top">
        <StatusPill row={row} />
      </td>
      <td className="px-1 py-3 align-top text-center review-col-line-no">
        <span className="review-line-no">{row.lineNo}</span>
      </td>
      <td className="px-3 py-3 align-top min-w-0">
        {partGroup?.isFirst ? <PartGroupBanner group={partGroup} /> : null}
        {isBatchContinuation ? (
          <div className="review-part-continuation">
            <p className="review-part-continuation__label">
              Batch {partGroup.index + 1} of {partGroup.size}
              {labelMrp != null ? ` · label ${formatRoundedRs(labelMrp)}` : ''}
            </p>
            <p className="text-xs font-medium text-[var(--content-tertiary)]">{product.pickCode}</p>
          </div>
        ) : (
          <>
            <p className="text-sm font-bold leading-snug text-[var(--content-primary)]">{product.name}</p>
            {product.pickCode ? (
              <p className="mt-1 font-mono text-xs font-semibold text-[var(--content-secondary)]">
                {product.pickCode}
                {product.altCode ? (
                  <span className="text-[var(--content-tertiary)]"> · {product.altCode}</span>
                ) : null}
              </p>
            ) : null}
          </>
        )}
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
      <td className="px-3 py-3 align-top text-right billing-col-qty">
        <BillingFigure value={qty} kind="integer" size="md" />
        <p className="review-qty-role">
          {fulfillment.excludeFromBusyBill ? 'skip' : 'bill'}
        </p>
      </td>
      <td className="px-3 py-3 align-top text-right">
        <SalesUnitBadge unit={effectiveSalesLineUnit(item, edit)} />
      </td>
      <td className="px-3 py-3 align-top billing-col-rate review-col-rate">
        <RateCell
          row={row}
          readOnly={readOnly}
          onPriceChange={(p) => billSheet.updatePrice(item.id, p, item)}
        />
      </td>
      <td className="px-3 py-3 align-top text-right billing-col-money">
        {fulfillment.excludeFromBusyBill ? (
          <span className="text-sm font-semibold text-[var(--content-tertiary)]">—</span>
        ) : (
          <BillingFigure value={lineTotal} kind="currency-raw" size="md" />
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
    <section
      id={group.id === 'skip' ? 'review-bill-skip-section' : undefined}
      className={
        group.id === 'bill'
          ? 'overflow-hidden bg-[var(--bg-primary)]'
          : 'overflow-hidden rounded-xl border-2 border-[var(--border-opaque)] bg-white shadow-sm'
      }
    >
      <GroupHeader group={group} collapsed={collapsed} onToggle={onToggle} />
      {!collapsed && group.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table
            className={`w-full border-collapse review-bill-table ${
              group.id === 'bill' ? 'ds-table ds-table--billing min-w-[880px]' : 'min-w-[880px]'
            }`}
          >
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
}

export function ReviewBillTable({
  billSheet,
  readOnly = false,
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

  const flaggedItemIds = useMemo(
    () => new Set(flaggedItems.map((i) => i.id)),
    [flaggedItems],
  );
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

  const hasSkipRows = groups.some((group) => group.id === 'skip' && group.rows.length > 0);

  const [collapsed, setCollapsed] = useState<Partial<Record<ReviewTableGroupId, boolean>>>(() =>
    readOnly && hasSkipRows ? { skip: false } : { skip: true },
  );

  const toggleGroup = (id: ReviewTableGroupId) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-4">
      <ReviewFulfillmentChips billSheet={billSheet} />

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
