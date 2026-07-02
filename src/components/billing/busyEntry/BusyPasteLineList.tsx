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
import { BusyEntryItemCell } from './BusyEntryItemCell';
import { BusyEntryLineChips } from './BusyEntryLineChips';
import { BusyEntryRateCell } from './BusyEntryRateCell';
import { BusyEntryQtyUnit } from './BusyEntryQtyUnit';
import { BusyBillableEmptyState } from './BusyBillableEmptyState';
import {
  BUSY_ENTRY_COL_CHECK,
  BUSY_ENTRY_COL_ITEM,
  BUSY_ENTRY_COL_QTY,
  BUSY_ENTRY_COL_RATE,
  BUSY_ENTRY_LINE_ROW,
  BUSY_ENTRY_LINE_ROW_HEADER,
  BUSY_ENTRY_LINE_ROW_SKIP,
} from './busyEntryLayout';

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
    <div className="busy-entry-lines flex flex-col min-h-0">
      <section>
        {billable.length === 0 && skip.length > 0 ? (
          <BusyBillableEmptyState skipCount={skip.length} compact />
        ) : null}
        <ul>
          {billable.length > 0 ? (
            <li
              className={`${BUSY_ENTRY_LINE_ROW_HEADER} px-0 border-b border-[var(--border-faint)] bg-[var(--bg-secondary)]`}
              aria-hidden
            >
              <div className={BUSY_ENTRY_COL_CHECK}>
                <BusyEntryMasterCheckbox
                  enteredCount={enteredCount}
                  totalCount={billable.length}
                  onToggleAll={toggleAllEntered}
                />
              </div>
              <span className={`busy-entry-col-header ${BUSY_ENTRY_COL_ITEM}`}>Item</span>
              <span className={`busy-entry-col-header ${BUSY_ENTRY_COL_RATE}`}>Bill rate</span>
              <span className={`busy-entry-col-header ${BUSY_ENTRY_COL_QTY}`}>Qty</span>
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
                className={`${BUSY_ENTRY_LINE_ROW} group relative cursor-pointer transition-colors duration-150 hover:bg-[var(--bg-secondary)]`}
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
                <div className={BUSY_ENTRY_COL_ITEM}>
                  <BusyEntryItemCell
                    item={item}
                    brandName={brand}
                    chips={
                      <BusyEntryLineChips
                        nature={nature}
                        flag={flag}
                        pendingQty={pendingQty}
                        isSkip={false}
                      />
                    }
                  />
                </div>
                <div className={BUSY_ENTRY_COL_RATE}>
                  <BusyEntryRateCell item={item} edit={edit} nature={nature} />
                </div>
                <div className={BUSY_ENTRY_COL_QTY}>
                  <BusyEntryQtyUnit item={item} lineEdit={edit} qty={qty} pendingQty={pendingQty} />
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
                  className={`${BUSY_ENTRY_LINE_ROW_SKIP} py-2 opacity-70`}
                  style={{
                    borderBottom: '0.5px dashed var(--border-opaque)',
                    background: 'var(--bg-secondary)',
                  }}
                >
                  <div className={BUSY_ENTRY_COL_ITEM}>
                    <BusyEntryItemCell
                      item={item}
                      brandName={brand}
                      muted
                      chips={<BusyEntryLineChips nature={nature} flag={flag} isSkip />}
                    />
                  </div>
                  <div className={BUSY_ENTRY_COL_RATE}>
                    <BusyEntryRateCell item={item} edit={edit} nature={nature} />
                  </div>
                  <div className={BUSY_ENTRY_COL_QTY}>
                    <BusyEntryQtyUnit
                      item={item}
                      qty={busyPendingQty(item, flag, edit)}
                      muted
                    />
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
