import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy } from '@phosphor-icons/react';
import {
  busyEntryBrandLabel,
  busyEntryLineNature,
  type BusyEntryLineNature,
} from '../../../lib/billing/busyEntryLineNature';
import { QueueSectionHeader } from '../../shared/QueueSectionHeader';
import {
  BusyEntryCheckbox,
  BusyEntryMasterCheckbox,
} from '../busyEntry/BusyEntryCheckbox';
import { BusyEntryCode } from '../busyEntry/BusyEntryCode';
import {
  markBusyEnteredIds,
  readBusyEnteredIds,
  toggleBusyEnteredId,
  writeBusyEnteredIds,
} from '../../../lib/billing/busyEntrySession';
import {
  busyBillableQty,
  busyPendingQty,
  isBusyBillableLine,
  isFullyPendingBusyLine,
} from '../../../lib/billing/busyLineSplit';
import { buildBusyPasteText, sortBillLines } from '../../../lib/billing/sortBillLines';
import { getBookPrice, getQuotedPrice } from '../../../lib/specialPricing';
import {
  formatCurrencyRaw,
  orderItemDisplayName,
} from '../../../utils/formatters';
import { useCopyToClipboard } from '../../../hooks/useCopyToClipboard';
import type { BillingLineEdit, ItemFlag } from '../../../hooks/useBillingFlow';
import type { OrderItem } from '../../../types';
import { BillingActionBar } from '../chrome/BillingActionBar';
import { BusyEntryCopyHint } from '../busyEntry/BusyEntryCopyHint';
import { deriveBusyFinishAction } from '../../../lib/billing/busyFinishAction';

type CopyState = 'ready' | 'copied' | 'settled';


function billedRate(item: OrderItem, edit?: BillingLineEdit): number | null {
  if (typeof edit?.priceQuoted === 'number' && Number.isFinite(edit.priceQuoted)) {
    return edit.priceQuoted;
  }
  return getQuotedPrice(item);
}

function formatRate(rate: number | null): string {
  return rate == null ? '—' : formatCurrencyRaw(rate);
}

function RateCell({
  item,
  edit,
}: {
  item: OrderItem;
  edit?: BillingLineEdit;
}): React.JSX.Element {
  const rate = billedRate(item, edit);
  const bookRate = getBookPrice(item);
  const showOriginal = bookRate != null && rate != null && bookRate !== rate;

  return (
    <span className="w-24 shrink-0 px-2 text-right tabular-nums">
      <span className="block text-[12px] font-semibold text-[var(--content-primary)]">
        {formatRate(rate)}
      </span>
      {showOriginal ? (
        <span className="block text-[9px] leading-tight text-[var(--content-quaternary)]">
          Orig {formatRate(bookRate)}
        </span>
      ) : null}
    </span>
  );
}

function BusyLineChips({
  nature,
  flag,
  pendingQty = 0,
}: {
  nature: BusyEntryLineNature;
  flag?: ItemFlag;
  pendingQty?: number;
}): React.JSX.Element | null {
  const pendingLabel =
    pendingQty > 0
      ? `${pendingQty} pending`
      : flag?.type === 'no_stock'
        ? 'Out of stock'
        : flag?.type === 'partial'
          ? 'Partial stock'
          : null;

  if (nature === 'normal' && !pendingLabel) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {nature === 'foc' ? (
        <span
          className="text-[9px] font-medium px-1.5 py-px rounded-[5px]"
          style={{ background: '#EAF3DE', color: '#27500A' }}
        >
          FOC
        </span>
      ) : null}
      {nature === 'special_rate' ? (
        <span
          className="text-[9px] font-medium px-1.5 py-px rounded-[5px]"
          style={{ background: '#EEEDFE', color: '#3C3489' }}
        >
          Special rate
        </span>
      ) : null}
      {pendingLabel ? (
        <span
          className="text-[9px] font-semibold px-1.5 py-px rounded-[5px]"
          style={{ background: '#E6F1FB', color: '#0C447C' }}
        >
          {pendingLabel}
        </span>
      ) : null}
    </div>
  );
}

function CopyAllItemsButton({
  copyState,
  disabled,
  onClick,
  compact = false,
}: {
  copyState: CopyState;
  disabled: boolean;
  onClick: () => void;
  compact?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-md font-semibold border transition-colors disabled:opacity-40 ${
        compact ? 'h-7 px-2 text-[11px]' : 'h-8 px-3 font-ds-caption-size'
      } ${
        copyState === 'copied'
          ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
          : 'border-[var(--content-primary)] bg-[var(--content-primary)] text-[var(--bg-primary)] hover:opacity-90'
      }`}
      style={{ borderWidth: '0.5px' }}
    >
      <Copy size={compact ? 12 : 14} />
      {copyState === 'copied'
        ? 'Copied'
        : copyState === 'settled'
          ? 'Copy all items again'
          : 'Copy all items'}
    </button>
  );
}

interface BusyPasteStageProps {
  orderId: number;
  items: OrderItem[];
  lineEdits: Record<number, BillingLineEdit>;
  flags: Record<number, ItemFlag>;
  onFinish: () => void;
  finishLabel?: string;
  finishDisabled?: boolean;
  finishLoading?: boolean;
  /** When false, parent owns copy/finish actions (e.g. OrderSheetView footer). */
  showActions?: boolean;
}

export function BusyPasteStage({
  orderId,
  items,
  lineEdits,
  flags,
  onFinish,
  finishLabel = 'Done — assign picker',
  finishDisabled = false,
  finishLoading = false,
  showActions = true,
}: BusyPasteStageProps): React.JSX.Element {
  const { copy } = useCopyToClipboard();
  const sorted = useMemo(() => sortBillLines(items), [items]);

  const billable = useMemo(
    () =>
      sorted.filter(
        (item) =>
          !lineEdits[item.id]?.removed &&
          isBusyBillableLine(item, flags[item.id], lineEdits[item.id]),
      ),
    [sorted, lineEdits, flags],
  );

  const skip = useMemo(
    () =>
      sorted.filter(
        (item) =>
          !lineEdits[item.id]?.removed && isFullyPendingBusyLine(flags[item.id]),
      ),
    [sorted, lineEdits, flags],
  );

  const [enteredIds, setEnteredIds] = useState(() => readBusyEnteredIds(orderId));
  const [copyState, setCopyState] = useState<CopyState>('ready');

  const toggleEntered = useCallback(
    (lineId: number) => {
      setEnteredIds(toggleBusyEnteredId(orderId, lineId));
    },
    [orderId],
  );

  const copyBillable = useCallback(() => {
    if (billable.length === 0) return;
    copy(
      buildBusyPasteText(billable, { lineEdits, flags, includeRate: true }),
      'busy-paste',
    );
    setCopyState('copied');
  }, [billable, lineEdits, copy]);

  const markAllEntered = useCallback(() => {
    if (billable.length === 0) return;
    setEnteredIds(markBusyEnteredIds(orderId, billable.map((row) => row.id)));
  }, [billable, orderId]);

  const toggleAllEntered = useCallback(() => {
    if (billable.length === 0) return;
    const next = readBusyEnteredIds(orderId);
    const allEntered = billable.every((row) => next.has(row.id));
    if (allEntered) {
      for (const row of billable) next.delete(row.id);
    } else {
      for (const row of billable) next.add(row.id);
    }
    writeBusyEnteredIds(orderId, next);
    setEnteredIds(next);
  }, [billable, orderId]);

  useEffect(() => {
    if (copyState === 'copied') {
      const t = setTimeout(() => setCopyState('settled'), 1500);
      return () => clearTimeout(t);
    }
  }, [copyState]);

  const totalLineCount = billable.length + skip.length;
  const enteredCount = billable.filter((item) => enteredIds.has(item.id)).length;
  const busyRemaining = Math.max(0, billable.length - enteredCount);
  const showCopyHint = copyState !== 'ready' && busyRemaining > 0;

  const finishAction = deriveBusyFinishAction({
    billableCount: billable.length,
    enteredCount,
    skipCount: skip.length,
    isApproving: finishLoading,
    enabledLabel: finishLabel,
  });

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <section>
          <div className="sticky top-0 z-10 bg-[var(--bg-primary)] border-b border-[var(--border-opaque)]">
            <QueueSectionHeader
              label="Bill these lines"
              count={billable.length}
              description={
                skip.length > 0
                  ? `${billable.length} billable of ${totalLineCount} total · ${skip.length} pending`
                  : undefined
              }
              sticky
              rightSlot={
                <CopyAllItemsButton
                  copyState={copyState}
                  disabled={billable.length === 0}
                  onClick={copyBillable}
                  compact
                />
              }
            />
            {showCopyHint ? (
              <BusyEntryCopyHint remaining={busyRemaining} onMarkAllEntered={markAllEntered} />
            ) : null}
          </div>
          <ul>
            {billable.length > 0 ? (
              <li
                className="flex items-center h-7 px-0 border-b border-[var(--border-faint)] bg-[var(--bg-secondary)] font-ds-micro font-semibold uppercase text-[var(--content-quaternary)]"
                aria-hidden
              >
                <span className="w-10 shrink-0 border-r border-[var(--border-opaque)]">
                  <BusyEntryMasterCheckbox
                    enteredCount={enteredCount}
                    totalCount={billable.length}
                    onToggleAll={toggleAllEntered}
                  />
                </span>
                <span className="w-2 shrink-0" />
                <span className="w-[130px] shrink-0 px-2.5">Part no.</span>
                <span className="min-w-0 flex-1 px-2.5">Description</span>
                <span className="w-24 shrink-0 px-2 text-right">Bill rate</span>
                <span className="w-14 shrink-0 px-2.5 text-right">Qty</span>
              </li>
            ) : null}
            {billable.map((item, index) => {
              const lineNo = index + 1;
              const entered = enteredIds.has(item.id);
              const edit = lineEdits[item.id];
              const flag = flags[item.id];
              const qty = busyBillableQty(item, flag, edit);
              const pendingQty = busyPendingQty(item, flag, edit);
              const nature = busyEntryLineNature(item);
              const brand = busyEntryBrandLabel(item);
              const stripe =
                nature === 'foc'
                  ? '#1D9E75'
                  : nature === 'special_rate'
                    ? '#7F77DD'
                    : 'var(--border-opaque)';
              return (
                <li
                  key={item.id}
                  onClick={() => toggleEntered(item.id)}
                  className="group flex items-center cursor-pointer transition-colors duration-150 hover:bg-[var(--bg-secondary)]"
                  style={{
                    minHeight: '44px',
                    borderBottom: '0.5px solid var(--border-opaque)',
                    background: entered
                      ? 'color-mix(in srgb, var(--bg-positive-subtle) 16%, var(--bg-secondary))'
                      : undefined,
                  }}
                >
                  <BusyEntryCheckbox
                    entered={entered}
                    itemName={orderItemDisplayName(item)}
                    lineNo={lineNo}
                    onToggle={() => toggleEntered(item.id)}
                  />
                  <div className="w-2 self-stretch shrink-0 flex items-center justify-center">
                    <span
                      className="block h-8 w-[2px] rounded-full"
                      style={{ background: stripe }}
                    />
                  </div>
                  <div className="w-[130px] shrink-0 px-2.5 py-2 border-r border-[var(--border-opaque)]">
                    <BusyEntryCode item={item} />
                    {brand ? (
                      <span className="block text-[10px] text-[var(--content-tertiary)] truncate mt-0.5">
                        {brand}
                      </span>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 px-2.5 py-2">
                    <span
                      className="text-[12px] font-medium truncate block text-[var(--content-primary)]"
                      title={orderItemDisplayName(item)}
                    >
                      {orderItemDisplayName(item)}
                    </span>
                    <BusyLineChips nature={nature} flag={flag} pendingQty={pendingQty} />
                  </div>
                  <RateCell item={item} edit={edit} />
                  <span className="w-14 shrink-0 px-2.5 text-[18px] font-medium tabular-nums text-right text-[var(--content-primary)]">
                    {qty}
                    {pendingQty > 0 ? (
                      <span className="block text-[9px] font-medium text-[var(--content-quaternary)]">
                        +{pendingQty} pending
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {skip.length > 0 ? (
          <section>
            <QueueSectionHeader
              label="Skip — pending"
              count={skip.length}
              variant="divider"
              description="out of stock · not billed today"
              sticky
            />
            <ul>
              {skip.map((item) => {
                const flag = flags[item.id];
                const edit = lineEdits[item.id];
                const nature = busyEntryLineNature(item);
                const brand = busyEntryBrandLabel(item);
                return (
                  <li
                    key={item.id}
                    className="grid grid-cols-[auto_minmax(0,1fr)_96px_56px] gap-x-3 items-center px-2.5 py-2.5 opacity-70"
                    style={{
                      borderBottom: '0.5px dashed var(--border-opaque)',
                      background: 'var(--bg-secondary)',
                    }}
                  >
                    <BusyEntryCode item={item} muted />
                    <div className="min-w-0">
                      <span className="text-[12px] text-[var(--content-tertiary)] truncate block">
                        {orderItemDisplayName(item)}
                      </span>
                      <div className="flex items-center gap-1 min-w-0">
                        {brand ? (
                          <span className="text-[9px] text-[var(--content-quaternary)] truncate">
                            {brand}
                          </span>
                        ) : null}
                        <BusyLineChips nature={nature} flag={flag} />
                      </div>
                    </div>
                    <RateCell item={item} edit={edit} />
                    <span className="text-[14px] tabular-nums text-right text-[var(--content-quaternary)]">
                      {busyPendingQty(item, flag, edit)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>

      {showActions ? (
        <BillingActionBar
          secondaryCopyLabel="Copy all items"
          onSecondaryCopy={copyBillable}
          secondaryCopyDisabled={billable.length === 0}
          ghostLabel="Mark all entered"
          onGhostClick={markAllEntered}
          gateWarning={finishAction.gateWarning}
          primaryLabel={finishAction.label}
          primaryDisabled={finishAction.disabled || finishDisabled}
          primaryLoading={finishLoading}
          onPrimary={onFinish}
        />
      ) : null}
    </div>
  );
}

export function busyPasteProgress(
  orderId: number,
  billableCount: number,
): { entered: number; total: number } {
  const entered = readBusyEnteredIds(orderId);
  const enteredInSet = [...entered].length;
  return {
    entered: Math.min(enteredInSet, billableCount),
    total: billableCount,
  };
}
