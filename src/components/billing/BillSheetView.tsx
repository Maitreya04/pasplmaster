import { BillLineRow, BillLineTableHeader } from './BillLineRow';
import { CompleteHandoffStage } from './stages/CompleteHandoffStage';
import { billLinePosition } from '../../lib/billing/sortBillLines';
import {
  DeskFlaggedLineRow,
  DeskFlaggedSectionHeader,
} from '../../pages/billing/BillingDesk/DeskFlaggedLineRow';
import { QueueSectionHeader } from '../shared/QueueSectionHeader';
import { formatCurrencyRaw } from '../../utils/formatters';
import {
  CHANGE_REASON_OPTIONS,
  type OverlayLineEdit,
} from '../../pages/billing/BillingDesk/types';
import type { BillSheetEdits } from '../../hooks/useBillSheetEdits';
import { summarizeBillFulfillment } from '../../lib/billing/billLineFulfillment';
import type { OrderItem, OrderWithItems } from '../../types';

export type BillSheetVariant = 'overlay' | 'page';
export type BillSheetMode = 'submitted' | 'post_pick';

export interface BillSheetViewProps {
  orderDetail: OrderWithItems;
  billSheet: BillSheetEdits;
  variant?: BillSheetVariant;
  mode?: BillSheetMode;
  showFooter?: boolean;
  flaggedMode?: boolean;
  /** Hide lines already covered by PO when resolving flags (desk default). */
  hidePoSkippedFlags?: boolean;
  /** Hide customer/total strip when parent chrome owns identity + summary zones. */
  hideOrderSummary?: boolean;
}

function isHiddenPoSkippedFlag(
  item: OrderItem,
  hidePoSkippedFlags: boolean,
  flaggedItemIds: Set<number>,
): boolean {
  return (
    hidePoSkippedFlags &&
    item.state === 'flagged' &&
    !flaggedItemIds.has(item.id)
  );
}

function isUnresolvedPickerFlag(
  item: OrderItem,
  edit: OverlayLineEdit | undefined,
  flaggedItemIds: Set<number>,
): boolean {
  return (
    item.state === 'flagged' &&
    flaggedItemIds.has(item.id) &&
    edit != null &&
    edit.resolution == null &&
    !edit.removed
  );
}

function BillFulfillmentSummary({
  items,
  pendingByItemId,
}: {
  items: OrderItem[];
  pendingByItemId: Map<number, import('../../types').PendingItem[]>;
}): React.JSX.Element | null {
  const totals = summarizeBillFulfillment(items, pendingByItemId);
  const hasPo = totals.salesPoQty > 0;
  const hasOos = totals.pickerOosQty > 0;
  const hasFoc = totals.focQty > 0;
  if (!hasPo && !hasOos && !hasFoc) return null;

  const skipCount = totals.salesPoQty + totals.pickerOosQty;

  return (
    <div className="px-3 py-2 border-b border-[var(--border-faint)] bg-[var(--bg-secondary)]">
      <QueueSectionHeader
        label="What to enter in Busy"
        count={totals.busyBillLines}
        tone="info"
        description={`${totals.billTodayQty} pcs to bill today${hasFoc ? ` (${totals.focQty} FOC at ₹0)` : ''}${
          skipCount > 0
            ? ` · Not billing today:${hasPo ? ` ${totals.salesPoQty} pcs on sales PO` : ''}${hasPo && hasOos ? ' ·' : ''}${hasOos ? ` ${totals.pickerOosQty} pcs picker out of stock` : ''}`
            : ''
        }`}
        sticky
      />
    </div>
  );
}

export function BillSheetView({
  orderDetail,
  billSheet,
  variant = 'overlay',
  mode = 'submitted',
  showFooter = true,
  hidePoSkippedFlags = true,
  hideOrderSummary = false,
}: BillSheetViewProps): React.JSX.Element {
  const compact = variant === 'overlay';
  const {
    sortedLines,
    edits,
    reason,
    setReason,
    setReasonTouched,
    pendingRemoveId,
    setPendingRemoveId,
    step,
    undoRemoveId,
    visibleItems,
    total,
    unresolvedFlagged,
    resolvedFlagged,
    resolvingFlags,
    allFlagsResolved,
    poSkippedFlagCount,
    showReasonDropdown,
    unresolvedPriceCount,
    unresolvedOosCount,
    acceptAllBoxPrices,
    removeAllOos,
    updatePrice,
    acceptBoxPrice,
    keepQuoted,
    removeFlaggedLine,
    undoRemove,
    patchEdit,
    acceptAllLabel,
    flaggedItems,
    pendingByItemId,
  } = billSheet;

  const flaggedItemIds = new Set(flaggedItems.map((item) => item.id));

  const displayLines = hidePoSkippedFlags
    ? sortedLines.filter(
        (item) =>
          item.state !== 'flagged' ||
          flaggedItemIds.has(item.id) ||
          edits[item.id]?.removed,
      )
    : sortedLines;

  const lineNodes: React.ReactNode[] = [];
  let billHeaderShown = false;
  let flaggedHeaderShown = false;

  for (const item of displayLines) {
    const edit = edits[item.id];
    if (!edit) continue;
    if (isHiddenPoSkippedFlag(item, hidePoSkippedFlags, flaggedItemIds)) continue;

    if (isUnresolvedPickerFlag(item, edit, flaggedItemIds)) {
      if (!flaggedHeaderShown) {
        lineNodes.push(<DeskFlaggedSectionHeader key="flagged-header" />);
        flaggedHeaderShown = true;
      }
      lineNodes.push(
        <DeskFlaggedLineRow
          key={item.id}
          item={item}
          edit={edit}
          onAcceptPrice={() => acceptBoxPrice(item)}
          onKeepQuoted={() => keepQuoted(item)}
          onRemove={() => removeFlaggedLine(item)}
          onUndoRemove={() => undoRemove(item.id)}
          onPriceChange={(price) => updatePrice(item.id, price, item)}
          showUndoRemove={undoRemoveId === item.id}
        />,
      );
      continue;
    }

    if (item.state === 'flagged' && edit.resolution == null && !edit.removed) {
      continue;
    }

    if (!billHeaderShown) {
      lineNodes.push(<BillLineTableHeader key="bill-header" compact={compact} />);
      billHeaderShown = true;
    }

    lineNodes.push(
      <BillLineRow
        key={item.id}
        lineNo={billLinePosition(item, sortedLines)}
        item={item}
        edit={edit}
        pendingRows={item.item_id != null ? pendingByItemId.get(item.item_id) ?? [] : []}
        isSplitChild={item.split_from_id != null}
        pendingRemoveId={pendingRemoveId}
        showUndoRemove={undoRemoveId === item.id}
        onAcceptPrice={() => acceptBoxPrice(item)}
        onKeepQuoted={() => keepQuoted(item)}
        onRemove={() => removeFlaggedLine(item)}
        onUndoRemove={() => undoRemove(item.id)}
        onPriceChange={(price) => updatePrice(item.id, price, item)}
        onRequestRemove={() => setPendingRemoveId(item.id)}
        onConfirmRemove={() => {
          patchEdit(item.id, { removed: true });
          setPendingRemoveId(null);
        }}
      />,
    );
  }

  return (
    <div
      className={
        variant === 'page'
          ? 'space-y-3'
          : 'flex flex-col min-h-0 flex-1 h-full'
      }
    >
      <div
        className={`rounded-lg border border-[var(--border-subtle)] overflow-hidden flex flex-col min-h-0 flex-1 ${
          variant === 'page' ? '' : 'mx-0'
        }`}
      >
        {mode === 'post_pick' && (
          <div className="shrink-0">
            <BillFulfillmentSummary items={visibleItems} pendingByItemId={pendingByItemId} />
          </div>
        )}
        {resolvingFlags && unresolvedFlagged.length > 0 && (
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-faint)] bg-[var(--bg-tertiary)]">
            <p className="font-ds-micro text-[var(--content-quaternary)]">
              Resolve flags inline · row order matches Busy paste
            </p>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {unresolvedPriceCount >= 2 && (
                <button
                  type="button"
                  onClick={acceptAllBoxPrices}
                  className="h-6 px-2 rounded-md font-ds-micro font-semibold bg-[var(--bg-positive)] text-white hover:opacity-95"
                >
                  {acceptAllLabel} ({unresolvedPriceCount})
                </button>
              )}
              {unresolvedOosCount >= 2 && (
                <button
                  type="button"
                  onClick={removeAllOos}
                  className="h-6 px-2 rounded-md font-ds-micro font-medium border border-[var(--border-negative)] text-[var(--content-negative)] hover:bg-[var(--bg-negative-subtle)]"
                >
                  Remove all ({unresolvedOosCount})
                </button>
              )}
            </div>
          </div>
        )}

        {poSkippedFlagCount > 0 && hidePoSkippedFlags && flaggedItems.length === 0 && (
          <p className="shrink-0 px-3 py-2 font-ds-micro text-[var(--content-quaternary)] border-b border-[var(--border-faint)] bg-[var(--bg-tertiary)]">
            {poSkippedFlagCount} flagged line{poSkippedFlagCount === 1 ? '' : 's'} already on PO — not
            shown on this bill
          </p>
        )}

        {lineNodes.length > 0 && (
          <div className={variant === 'overlay' ? 'flex-1 min-h-0 overflow-y-auto' : undefined}>
            {lineNodes}
          </div>
        )}

        {resolvingFlags && allFlagsResolved && unresolvedFlagged.length === 0 && (
          <p className="shrink-0 px-3 py-2 text-[11px] text-[var(--content-positive)] border-t border-[var(--border-faint)]">
            All flagged lines resolved
          </p>
        )}
      </div>

      {!hideOrderSummary ? (
        <div className="shrink-0 rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 flex justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--content-primary)] truncate">
              {orderDetail.customer_name}
            </p>
            <p className="font-ds-micro text-[var(--content-quaternary)] mt-0.5">
              {orderDetail.picker_name ? `Picker: ${orderDetail.picker_name}` : 'No picker yet'}
              {resolvedFlagged.length > 0
                ? ` · ${resolvedFlagged.length} resolved`
                : ''}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className={`font-medium tabular-nums ${compact ? 'text-[15px]' : 'text-lg'}`}>
              {formatCurrencyRaw(total)}
            </p>
            <p className="font-ds-micro text-[var(--content-quaternary)]">
              {visibleItems.length} items
            </p>
          </div>
        </div>
      ) : null}

      {showReasonDropdown && (
        <div className="shrink-0">
          <label
            htmlFor="bill-change-reason"
            className="font-ds-micro font-semibold uppercase tracking-wide text-[var(--content-quaternary)]"
          >
            Reason for any changes
          </label>
          <select
            id="bill-change-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as typeof reason);
              setReasonTouched(true);
            }}
            className="mt-1 w-full h-9 px-2 text-sm rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-secondary)]"
          >
            {CHANGE_REASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {showFooter && (
        <footer className="shrink-0 border-t border-[var(--border-subtle)]">
          {resolvingFlags && step === 'idle' && (
            <p className="font-ds-micro text-[var(--content-quaternary)] text-center px-3 pt-2">
              {allFlagsResolved
                ? 'All flagged lines resolved — save to continue'
                : `${resolvedFlagged.length} of ${flaggedItems.length} flagged lines resolved`}
            </p>
          )}
          <CompleteHandoffStage
            variant="bill_save"
            orderNumber={orderDetail.order_number}
            orderName={orderDetail.customer_name}
            salesperson={orderDetail.salesperson_name}
            billSheet={billSheet}
          />
        </footer>
      )}
    </div>
  );
}
