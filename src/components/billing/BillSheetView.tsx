import { Bell, Check, Receipt } from '@phosphor-icons/react';
import { BillLineRow, BillLineTableHeader } from './BillLineRow';
import { billLinePosition } from '../../lib/billing/sortBillLines';
import {
  DeskFlaggedLineRow,
  DeskFlaggedSectionHeader,
} from '../../pages/billing/BillingDesk/DeskFlaggedLineRow';
import { formatCurrencyRaw } from '../../utils/formatters';
import {
  CHANGE_REASON_OPTIONS,
  type OverlayLineEdit,
} from '../../pages/billing/BillingDesk/types';
import type { BillSheetEdits } from '../../hooks/useBillSheetEdits';
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
}

function StepCircle({
  state,
  number,
}: {
  state: 'active' | 'done' | 'waiting';
  number: number;
}): React.JSX.Element {
  if (state === 'done') {
    return (
      <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center bg-[var(--bg-positive-subtle)] border border-[var(--border-positive)] text-[var(--content-positive)] shrink-0">
        <Check size={12} weight="bold" />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center bg-[var(--bg-positive)] text-white text-xs font-semibold shrink-0">
        {number}
      </span>
    );
  }
  return (
    <span className="w-[22px] h-[22px] rounded-full flex items-center justify-center bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-[var(--content-quaternary)] text-xs shrink-0">
      {number}
    </span>
  );
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

export function BillSheetView({
  orderDetail,
  billSheet,
  variant = 'overlay',
  showFooter = true,
  flaggedMode = false,
  hidePoSkippedFlags = true,
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
    saveBlocked,
    notifyPickerAllowed,
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
    saveMutation,
    notifyMutation,
    acceptAllLabel,
    flaggedItems,
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
    <div className={variant === 'page' ? 'space-y-3' : 'flex flex-col min-h-0 flex-1'}>
      <div
        className={`rounded-lg border border-[var(--border-subtle)] overflow-hidden ${
          variant === 'page' ? '' : 'mx-0'
        }`}
      >
        {resolvingFlags && unresolvedFlagged.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border-faint)] bg-[var(--bg-tertiary)]">
            <p className="text-[10px] text-[var(--content-quaternary)]">
              Resolve flags inline · row order matches Busy paste
            </p>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
              {unresolvedPriceCount >= 2 && (
                <button
                  type="button"
                  onClick={acceptAllBoxPrices}
                  className="h-6 px-2 rounded-md text-[9px] font-semibold bg-[var(--bg-positive)] text-white hover:opacity-95"
                >
                  {acceptAllLabel} ({unresolvedPriceCount})
                </button>
              )}
              {unresolvedOosCount >= 2 && (
                <button
                  type="button"
                  onClick={removeAllOos}
                  className="h-6 px-2 rounded-md text-[9px] font-medium border border-[var(--border-negative)] text-[var(--content-negative)] hover:bg-[var(--bg-negative-subtle)]"
                >
                  Remove all ({unresolvedOosCount})
                </button>
              )}
            </div>
          </div>
        )}

        {poSkippedFlagCount > 0 && hidePoSkippedFlags && flaggedItems.length === 0 && (
          <p className="px-3 py-2 text-[10px] text-[var(--content-quaternary)] border-b border-[var(--border-faint)] bg-[var(--bg-tertiary)]">
            {poSkippedFlagCount} flagged line{poSkippedFlagCount === 1 ? '' : 's'} already on PO — not
            shown on this bill
          </p>
        )}

        {lineNodes.length > 0 && <div>{lineNodes}</div>}

        {resolvingFlags && allFlagsResolved && unresolvedFlagged.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-[var(--content-positive)] border-t border-[var(--border-faint)]">
            All flagged lines resolved
          </p>
        )}
      </div>

      <div className="rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 flex justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--content-primary)] truncate">
            {orderDetail.customer_name}
          </p>
          <p className="text-[10px] text-[var(--content-quaternary)] mt-0.5">
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
          <p className="text-[10px] text-[var(--content-quaternary)]">
            {visibleItems.length} items
          </p>
        </div>
      </div>

      {showReasonDropdown && (
        <div>
          <label
            htmlFor="bill-change-reason"
            className="text-[10px] font-semibold uppercase tracking-wide text-[var(--content-quaternary)]"
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
        <footer className="shrink-0 space-y-1.5 pt-1 border-t border-[var(--border-subtle)]">
          {resolvingFlags && step === 'idle' && (
            <p className="text-[10px] text-[var(--content-quaternary)] text-center">
              {allFlagsResolved
                ? 'All flagged lines resolved — save to continue'
                : `${resolvedFlagged.length} of ${flaggedItems.length} flagged lines resolved`}
            </p>
          )}
          <div className="flex items-center gap-2.5">
            <StepCircle state={step === 'idle' ? 'active' : 'done'} number={1} />
            <button
              type="button"
              disabled={saveMutation.isPending || step !== 'idle' || saveBlocked}
              onClick={() => saveMutation.mutate()}
              className={`flex-1 h-10 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-2 ${
                step !== 'idle'
                  ? 'bg-[var(--bg-positive-subtle)] border border-[var(--border-positive)] text-[var(--content-positive)] cursor-default'
                  : 'bg-[var(--bg-positive)] text-white hover:opacity-95 disabled:opacity-50'
              }`}
            >
              {step !== 'idle' ? (
                <>
                  <Check size={16} weight="bold" />
                  {flaggedMode ? 'Flag resolved ✓' : 'Bill saved ✓'}
                </>
              ) : (
                <>
                  <Receipt size={16} weight="bold" />
                  {saveBlocked
                    ? `Resolve ${unresolvedFlagged.length} flagged line${unresolvedFlagged.length === 1 ? '' : 's'} first`
                    : flaggedMode
                      ? 'Resolve & save'
                      : 'Save & Bill'}
                </>
              )}
            </button>
          </div>
          <div className="flex items-center gap-2.5">
            <StepCircle
              state={
                !notifyPickerAllowed
                  ? 'waiting'
                  : step === 'saved'
                    ? 'active'
                    : step === 'notified'
                      ? 'done'
                      : 'waiting'
              }
              number={2}
            />
            {notifyPickerAllowed ? (
              <button
                type="button"
                disabled={
                  step === 'idle' ||
                  step === 'notified' ||
                  notifyMutation.isPending ||
                  saveMutation.isPending
                }
                onClick={() => notifyMutation.mutate()}
                className={`flex-1 h-10 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-2 ${
                  step === 'notified'
                    ? 'bg-[var(--bg-positive-subtle)] border border-[var(--border-positive)] text-[var(--content-positive)] cursor-default'
                    : step === 'saved'
                      ? 'bg-[var(--bg-positive)] text-white hover:opacity-95'
                      : 'bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] text-[var(--content-quaternary)] cursor-not-allowed'
                }`}
              >
                {step === 'notified' ? (
                  <>
                    <Check size={16} weight="bold" />
                    Picker notified — on their way
                  </>
                ) : (
                  <>
                    <Bell size={16} weight="bold" />
                    Notify picker — collect bill
                  </>
                )}
              </button>
            ) : (
              <p className="flex-1 text-[11px] text-[var(--content-quaternary)] leading-snug">
                {orderDetail.workflow_status === 'picking' ||
                orderDetail.workflow_status === 'completed'
                  ? 'Pick already started or done — no new queue alert needed.'
                  : 'Notify picker is only for orders waiting in the pick queue.'}
              </p>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}
