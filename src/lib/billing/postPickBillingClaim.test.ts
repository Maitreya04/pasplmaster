import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canOpenDeskOrder,
  deskOrderClaimBlockedBy,
  needsPostPickBillingClaim,
} from './postPickBillingClaim';

const warehouseAwaitingReview = {
  workflow_status: 'completed' as const,
  fulfillment_path: 'warehouse_pick' as const,
  stock_location_code: 'main_store' as const,
  picking_completed_at: '2026-06-05T12:00:00Z',
  reviewer_name: null,
};

test('needsPostPickBillingClaim true for completed warehouse pick awaiting review', () => {
  assert.equal(needsPostPickBillingClaim(warehouseAwaitingReview), true);
});

test('needsPostPickBillingClaim false when reviewer_name set', () => {
  assert.equal(
    needsPostPickBillingClaim({ ...warehouseAwaitingReview, reviewer_name: 'Neetu' }),
    false,
  );
});

test('needsPostPickBillingClaim false for direct_bill', () => {
  assert.equal(
    needsPostPickBillingClaim({
      ...warehouseAwaitingReview,
      fulfillment_path: 'direct_bill',
    }),
    false,
  );
});

test('canOpenDeskOrder allows stale or unclaimed orders', () => {
  assert.equal(canOpenDeskOrder({ claim_info: null, is_mine: false }), true);
  assert.equal(
    canOpenDeskOrder({
      claim_info: {
        is_stale: true,
        claimed_by_name: 'Neetu',
      },
      is_mine: false,
    }),
    true,
  );
});

test('canOpenDeskOrder blocks fresh claim by another person', () => {
  assert.equal(
    canOpenDeskOrder({
      claim_info: {
        is_stale: false,
        claimed_by_name: 'Neetu',
      },
      is_mine: false,
    }),
    false,
  );
  assert.equal(deskOrderClaimBlockedBy({
    claim_info: {
      is_stale: false,
      claimed_by_name: 'Neetu',
    },
    is_mine: false,
  }), 'Neetu');
});
