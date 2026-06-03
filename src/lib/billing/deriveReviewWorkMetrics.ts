import { busyEntryLineNature } from './busyEntryLineNature';
import {
  deriveBillLineFulfillment,
  summarizeBillFulfillment,
} from './billLineFulfillment';
import type { BillSheetEdits } from '../../hooks/useBillSheetEdits';

export interface ReviewWorkMetrics {
  billableCount: number;
  qtyTotal: number;
  specialRateCount: number;
  focCount: number;
  pendingCount: number;
}

/** Stats for the shared billing work dock on verify / finalise stages. */
export function deriveReviewWorkMetrics(billSheet: BillSheetEdits): ReviewWorkMetrics {
  const { visibleItems, pendingByItemId, edits } = billSheet;

  const fulfillment = summarizeBillFulfillment(visibleItems, pendingByItemId);

  const copyableItems = visibleItems.filter((item) => {
    const edit = edits[item.id];
    if (edit?.removed) return false;
    if (item.state === 'flagged' && edit?.resolution == null) return false;
    const pending =
      item.item_id != null ? pendingByItemId.get(item.item_id) ?? [] : [];
    return !deriveBillLineFulfillment(item, pending).excludeFromBusyBill;
  });

  const specialRateCount = copyableItems.filter(
    (item) => busyEntryLineNature(item) === 'special_rate',
  ).length;
  const focCount = copyableItems.filter(
    (item) => busyEntryLineNature(item) === 'foc',
  ).length;
  const pendingLineCount = visibleItems.filter((item) => {
    if (edits[item.id]?.removed) return false;
    const pending =
      item.item_id != null ? pendingByItemId.get(item.item_id) ?? [] : [];
    const f = deriveBillLineFulfillment(item, pending);
    return f.excludeFromBusyBill || f.qtySalesPo > 0 || f.qtyPickerOos > 0;
  }).length;

  return {
    billableCount: copyableItems.length,
    qtyTotal: fulfillment.billTodayQty,
    specialRateCount,
    focCount: focCount,
    pendingCount: pendingLineCount,
  };
}
