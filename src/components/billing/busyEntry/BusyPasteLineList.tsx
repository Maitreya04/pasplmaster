import {
  busyEntryBrandLabel,
  busyEntryLineNature,
  type BusyEntryLineNature,
} from '../../../lib/billing/busyEntryLineNature';
import {
  busyBillableQty,
  busyPendingQty,
} from '../../../lib/billing/busyLineSplit';
import type { BusyPasteModel } from '../../../lib/billing/useBusyPasteModel';
import { orderItemDisplayName } from '../../../utils/formatters';
import type { BillingLineEdit, ItemFlag } from '../../../hooks/useBillingFlow';
import { QueueSectionHeader } from '../../shared/QueueSectionHeader';
import {
  BusyEntryCheckbox,
  BusyEntryMasterCheckbox,
} from './BusyEntryCheckbox';
import { BusyEntryCode } from './BusyEntryCode';
import { BusyEntryLineChips } from './BusyEntryLineChips';
import { BusyEntryRateCell } from './BusyEntryRateCell';
import { SalesUnitBadge } from '../../shared/SalesUnitBadge';
import { BusyEntryQtyUnit } from './BusyEntryQtyUnit';
import { BusyBillableEmptyState } from './BusyBillableEmptyState';
import { effectiveSalesLineUnit } from '../../../lib/salesUnit';

function busyEntryAccentColor(
  nature: BusyEntryLineNature,
  flag?: ItemFlag,
  pendingQty = 0,
): string | null {
  if (pendingQty > 0 || flag?.type === 'no_stock' || flag?.type === 'partial') {
    return 'var(--border-warning)';
  }
  if (nature === 'foc') return 'var(--content-positive)';
  if (nature === 'special_rate') return 'var(--content-accent)';
  if (nature === 'scheme') return '#EF9F27';
  return null;
}

interface BusyPasteLineListProps {
  model: BusyPasteModel;
  lineEdits: Record<number, BillingLineEdit>;
  flags: Record<number, ItemFlag>;
}

export function BusyPasteLineList({
  model,
  lineEdits,
  flags,
}: BusyPasteLineListProps): React.JSX.Element {
  const {
    billable,
    skip,
    enteredIds,
    enteredCount,
    toggleEntered,
    toggleAllEntered,
    registerLineRef,
  } = model;

  return (
    <div className="flex flex-col min-h-0">
      <section>
        {billable.length === 0 && skip.length > 0 ? (
          <BusyBillableEmptyState skipCount={skip.length} compact />
        ) : null}
        <ul>
          {billable.length > 0 ? (
            <li
              className="flex items-center h-7 px-0 border-b border-[var(--border-faint)] bg-[var(--bg-secondary)]"
              aria-hidden
            >
              <span className="w-10 shrink-0 border-r border-[var(--border-opaque)]">
                <BusyEntryMasterCheckbox
                  enteredCount={enteredCount}
                  totalCount={billable.length}
                  onToggleAll={toggleAllEntered}
                />
              </span>
              <span className="busy-entry-col-header w-[148px] shrink-0 px-3">Part no.</span>
              <span className="busy-entry-col-header min-w-0 flex-1 px-2.5">Description</span>
              <div className="busy-entry-entry-strip shrink-0 pr-2.5">
                <span className="busy-entry-col-header w-[5.5rem] text-right">Bill rate</span>
                <span className="busy-entry-col-header w-[5.25rem] text-right">Unit</span>
                <span className="busy-entry-col-header w-[4.5rem] text-right">Qty</span>
              </div>
            </li>
          ) : null}
          {billable.map((item) => {
            const entered = enteredIds.has(item.id);
            const edit = lineEdits[item.id];
            const flag = flags[item.id];
            const qty = busyBillableQty(item, flag, edit);
            const pendingQty = busyPendingQty(item, flag, edit);
            const nature = busyEntryLineNature(item);
            const brand = busyEntryBrandLabel(item);
            const accentColor = busyEntryAccentColor(nature, flag, pendingQty);
            return (
              <li
                key={item.id}
                ref={(el) => registerLineRef(item.id, el)}
                onClick={() => toggleEntered(item.id)}
                className="group relative flex items-center cursor-pointer transition-colors duration-150 hover:bg-[var(--bg-secondary)]"
                style={{
                  minHeight: '44px',
                  borderBottom: '0.5px solid var(--border-opaque)',
                  background: entered
                    ? 'color-mix(in srgb, var(--bg-positive-subtle) 16%, var(--bg-secondary))'
                    : undefined,
                  boxShadow: accentColor ? `inset 3px 0 0 ${accentColor}` : undefined,
                }}
              >
                <BusyEntryCheckbox
                  entered={entered}
                  itemName={orderItemDisplayName(item)}
                  onToggle={() => toggleEntered(item.id)}
                />
                <div className="w-[148px] shrink-0 px-3 py-2 border-r border-[var(--border-opaque)]">
                  <BusyEntryCode item={item} />
                  {brand ? (
                    <span className="busy-entry-brand truncate">{brand}</span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 px-2.5 py-2">
                  <span
                    className="busy-entry-desc truncate block"
                    title={orderItemDisplayName(item)}
                  >
                    {orderItemDisplayName(item)}
                  </span>
                  <BusyEntryLineChips
                    nature={nature}
                    flag={flag}
                    pendingQty={pendingQty}
                    isSkip={false}
                  />
                </div>
                <div className="busy-entry-entry-strip shrink-0 py-2 pr-2.5">
                  <span className="w-[5.5rem] shrink-0 px-1">
                    <BusyEntryRateCell item={item} edit={edit} nature={nature} />
                  </span>
                  <span className="w-[5.25rem] shrink-0 px-1 flex justify-end">
                    <SalesUnitBadge unit={effectiveSalesLineUnit(item, edit)} />
                  </span>
                  <span className="w-[4.5rem] shrink-0 px-1">
                    <BusyEntryQtyUnit item={item} lineEdit={edit} qty={qty} pendingQty={pendingQty} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {skip.length > 0 ? (
        <section>
          <QueueSectionHeader
            label="Pending stock"
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
                  ref={(el) => registerLineRef(item.id, el)}
                  className="flex items-center gap-3 px-2.5 py-2.5 opacity-70"
                  style={{
                    borderBottom: '0.5px dashed var(--border-opaque)',
                    background: 'var(--bg-secondary)',
                  }}
                >
                  <BusyEntryCode item={item} muted />
                  <div className="min-w-0 flex-1">
                    <span className="busy-entry-desc truncate block text-[var(--content-tertiary)]">
                      {orderItemDisplayName(item)}
                    </span>
                    <div className="flex items-center gap-1 min-w-0">
                      {brand ? (
                        <span className="busy-entry-brand busy-entry-brand--inline truncate">
                          {brand}
                        </span>
                      ) : null}
                      <BusyEntryLineChips nature={nature} flag={flag} isSkip />
                    </div>
                  </div>
                  <div className="busy-entry-entry-strip busy-entry-entry-strip--plain shrink-0">
                    <span className="w-[5.5rem] shrink-0">
                      <BusyEntryRateCell item={item} edit={edit} nature={nature} />
                    </span>
                    <span className="w-[4.5rem] shrink-0">
                      <BusyEntryQtyUnit
                        item={item}
                        qty={busyPendingQty(item, flag, edit)}
                        muted
                      />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
