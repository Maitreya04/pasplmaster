import { describe, expect, it } from 'vitest';
import { deriveReviewWorkMetrics } from './deriveReviewWorkMetrics';
import type { BillSheetEdits } from '../../hooks/useBillSheetEdits';

function minimalBillSheet(overrides: Partial<BillSheetEdits> = {}): BillSheetEdits {
  return {
    visibleItems: [],
    pendingByItemId: new Map(),
    edits: {},
    ...overrides,
  } as BillSheetEdits;
}

describe('deriveReviewWorkMetrics', () => {
  it('returns zero counts for an empty bill sheet', () => {
    expect(deriveReviewWorkMetrics(minimalBillSheet())).toEqual({
      billableCount: 0,
      qtyTotal: 0,
      specialRateCount: 0,
      focCount: 0,
      pendingCount: 0,
      pickerOosCount: 0,
      pickerOosQty: 0,
      billingOosCount: 0,
    });
  });
});
