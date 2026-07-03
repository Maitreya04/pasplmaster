import { busyEntryLineNature } from './busyEntryLineNature';
import {
  buildFinalBillCopyRows,
  buildFinalBillSkipRows,
  buildPickerOosSummaryRows,
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
  pickerOosCount: number;
  pickerOosQty: number;
  billingOosCount: number;
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
  const skipRows = buildFinalBillSkipRows({
    sortedLines,
    edits,
    pendingByItemId,
    flaggedItems,
  });
  const pickerOosRows = buildPickerOosSummaryRows({
    sortedLines,
    edits,
    pendingByItemId,
    flaggedItems,
  });

  return {
    billableCount: totals.lineCount,
    qtyTotal: totals.qtyTotal,
    specialRateCount,
    focCount: focCount,
    pendingCount: pendingLineCount,
    pickerOosCount: pickerOosRows.length,
    pickerOosQty: pickerOosRows.reduce((sum, row) => sum + row.qty, 0),
    billingOosCount: skipRows.filter((row) => row.role === 'billing_oos').length,
  };
}
