import { busyEntryLineNature } from './busyEntryLineNature';
import {
  buildFinalBillCopyRows,
  countFinalBillPendingRows,
  finalBillCopyTotals,
} from './finalBillCopy';
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
  const { sortedLines, pendingByItemId, edits, flaggedItems } = billSheet;
  const rows = buildFinalBillCopyRows({
    sortedLines,
    edits,
    pendingByItemId,
    flaggedItems,
  });
  const totals = finalBillCopyTotals(rows);
  const copyableItems = rows.map((row) => row.item);

  const specialRateCount = copyableItems.filter(
    (item) => busyEntryLineNature(item) === 'special_rate',
  ).length;
  const focCount = copyableItems.filter(
    (item) => busyEntryLineNature(item) === 'foc',
  ).length;
  const pendingLineCount = countFinalBillPendingRows({
    sortedLines,
    edits,
    pendingByItemId,
  });

  return {
    billableCount: totals.lineCount,
    qtyTotal: totals.qtyTotal,
    specialRateCount,
    focCount: focCount,
    pendingCount: pendingLineCount,
  };
}
