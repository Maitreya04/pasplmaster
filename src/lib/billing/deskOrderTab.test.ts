import { describe, expect, it } from 'vitest';
import {
  isDeskBillingFinalized,
  needsDeskBillReview,
  orderSkipsDeskBillReview,
} from './deskOrderTab';

describe('deskOrderTab', () => {
  it('treats direct bill and Jabalpur as skipping desk review', () => {
    expect(
      orderSkipsDeskBillReview({
        workflow_status: 'completed',
        fulfillment_path: 'direct_bill',
      }),
    ).toBe(true);
    expect(
      orderSkipsDeskBillReview({
        workflow_status: 'completed',
        stock_location_code: 'jabalpur',
      }),
    ).toBe(true);
    expect(
      orderSkipsDeskBillReview({
        workflow_status: 'completed',
        fulfillment_path: 'warehouse_pick',
        stock_location_code: 'main_store',
      }),
    ).toBe(false);
  });

  it('finalizes completed direct bill without reviewer_name', () => {
    expect(
      isDeskBillingFinalized({
        workflow_status: 'completed',
        fulfillment_path: 'direct_bill',
        reviewer_name: null,
      }),
    ).toBe(true);
  });

  it('keeps warehouse pick in review until reviewer is set', () => {
    const warehouse = {
      workflow_status: 'completed' as const,
      fulfillment_path: 'warehouse_pick' as const,
      stock_location_code: 'main_store' as const,
      reviewer_name: null,
    };
    expect(needsDeskBillReview(warehouse)).toBe(true);
    expect(
      isDeskBillingFinalized({ ...warehouse, reviewer_name: 'Priya' }),
    ).toBe(true);
  });
});
