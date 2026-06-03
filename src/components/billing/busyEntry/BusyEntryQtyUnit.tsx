import { effectiveSalesLineUnit, salesLineUnitLabel } from '../../../lib/salesUnit';
import type { BillingLineEdit } from '../../../lib/billing/liveQueueDraft';
import type { OrderItem } from '../../../types';

interface BusyEntryQtyUnitProps {
  qty: number | string;
  item: OrderItem;
  lineEdit?: Pick<BillingLineEdit, 'salesUnit'> | null;
  pendingQty?: number;
  muted?: boolean;
}

/** Qty + unit as one entry token — e.g. "2 Pcs". */
export function BusyEntryQtyUnit({
  qty,
  item,
  lineEdit,
  pendingQty = 0,
  muted = false,
}: BusyEntryQtyUnitProps): React.JSX.Element {
  const unit = salesLineUnitLabel(effectiveSalesLineUnit(item, lineEdit));

  return (
    <span className="block text-right tabular-nums">
      <span className="inline-flex items-baseline justify-end gap-1">
        <span className={`busy-entry-qty ${muted ? 'busy-entry-qty--muted' : ''}`}>{qty}</span>
        <span className="busy-entry-unit">{unit}</span>
      </span>
      {pendingQty > 0 ? (
        <span className="busy-entry-pending-qty">+{pendingQty} pending</span>
      ) : null}
    </span>
  );
}
