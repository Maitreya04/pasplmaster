import { describe, expect, it } from 'vitest';
import { isPickQueueEligibleForBranch } from './pickQueueEligibility';
import type { Order } from '../../types';

const baseOrder: Order = {
  id: 1,
  order_number: 'PA-001',
  customer_id: 1,
  customer_name: 'Test',
  customer_city: null,
  transport_id: null,
  transport_name: null,
  salesperson_name: 'Satish',
  reviewer_name: null,
  picker_name: null,
  workflow_status: 'approved',
  priority: 'normal',
  notes: null,
  item_count: 1,
  total_value: 100,
  created_at: new Date().toISOString(),
  approved_at: null,
  picked_at: null,
  completed_at: null,
  dispatched_at: null,
  stock_location_code: 'main_store',
  fulfillment_path: 'warehouse_pick',
};

describe('isPickQueueEligibleForBranch', () => {
  it('excludes direct bill orders', () => {
    expect(
      isPickQueueEligibleForBranch(
        { ...baseOrder, fulfillment_path: 'direct_bill' },
        'main_store',
      ),
    ).toBe(false);
  });

  it('matches picker branch', () => {
    expect(isPickQueueEligibleForBranch(baseOrder, 'main_store')).toBe(true);
    expect(
      isPickQueueEligibleForBranch({ ...baseOrder, stock_location_code: 'jabalpur' }, 'main_store'),
    ).toBe(false);
    expect(
      isPickQueueEligibleForBranch({ ...baseOrder, stock_location_code: 'jabalpur' }, 'jabalpur'),
    ).toBe(true);
  });

  it('falls back to Indore-only when branch unknown', () => {
    expect(isPickQueueEligibleForBranch(baseOrder, null)).toBe(true);
    expect(
      isPickQueueEligibleForBranch({ ...baseOrder, stock_location_code: 'jabalpur' }, null),
    ).toBe(false);
  });
});
