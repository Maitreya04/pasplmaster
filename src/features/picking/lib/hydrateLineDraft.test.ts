import { describe, expect, it } from 'vitest';
import type { OrderItem } from '../../../types';
import {
  buildLineDraftFromOrderItem,
  deriveCompletedLinesFromOrder,
  deriveLineCompletionStatus,
} from './hydrateLineDraft';

function stubItem(partial: Partial<OrderItem> & Pick<OrderItem, 'id'>): OrderItem {
  return {
    order_id: 1,
    item_id: 100,
    item_name: 'Widget',
    item_alias: 'W1',
    rack_no: 'A1',
    qty_requested: 10,
    qty_shippable: 10,
    qty_po: 0,
    qty_approved: 10,
    price_quoted: 100,
    price_system: 100,
    state: 'pending',
    scan_result: null,
    ...partial,
  } as OrderItem;
}

describe('buildLineDraftFromOrderItem', () => {
  it('hydrates MRP split segments and preserves original target qty', () => {
    const root = stubItem({
      id: 1,
      qty_requested: 7,
      qty_shippable: 7,
      qty_approved: 7,
      state: 'picked',
      confirmed_mrp: 181,
      scan_result: {
        matchStrategy: 'price_group',
        confirmedMrp: 181,
        progress: { pickedQty: 7, remainingQty: 3, targetQty: 10 },
      } as OrderItem['scan_result'],
    });
    const split = stubItem({
      id: 2,
      split_from_id: 1,
      qty_requested: 3,
      qty_shippable: 3,
      qty_approved: 3,
      state: 'picked',
      confirmed_mrp: 181,
      scan_result: {
        matchStrategy: 'price_group',
        confirmedMrp: 181,
        progress: { pickedQty: 10, remainingQty: 0, targetQty: 10 },
      } as OrderItem['scan_result'],
    });
    const items = [root, split];

    const draft = buildLineDraftFromOrderItem(root, items);
    expect(draft.targetQty).toBe(10);
    expect(draft.confirmedGroups).toHaveLength(2);
    expect(draft.confirmedGroups[0]?.qty).toBe(7);
    expect(draft.confirmedGroups[1]?.qty).toBe(3);
  });

  it('returns empty draft for untouched lines', () => {
    const root = stubItem({ id: 1 });
    const draft = buildLineDraftFromOrderItem(root, [root]);
    expect(draft.confirmedGroups).toHaveLength(0);
    expect(draft.targetQty).toBe(10);
  });
});

describe('deriveLineCompletionStatus', () => {
  it('treats active multi-batch picks as still open', () => {
    const root = stubItem({
      id: 1,
      qty_requested: 7,
      qty_shippable: 7,
      qty_approved: 7,
      state: 'picked',
      confirmed_mrp: 181,
      scan_result: {
        matchStrategy: 'price_group',
        confirmedMrp: 181,
        progress: { pickedQty: 7, remainingQty: 3, targetQty: 10 },
      } as OrderItem['scan_result'],
    });

    expect(deriveLineCompletionStatus(root, [root])).toBeNull();
  });

  it('marks partial when short pick is finalized', () => {
    const root = stubItem({
      id: 1,
      qty_requested: 2,
      qty_shippable: 1,
      qty_approved: 2,
      state: 'picked',
      confirmed_mrp: 181,
      scan_result: {
        matchStrategy: 'price_group',
        confirmedMrp: 181,
        isShortPick: true,
        progress: { pickedQty: 1, remainingQty: 1, targetQty: 2 },
      } as OrderItem['scan_result'],
    });

    expect(deriveLineCompletionStatus(root, [root])).toBe('partial');
  });

  it('marks picked when all qty is logged across splits', () => {
    const root = stubItem({
      id: 1,
      qty_requested: 7,
      qty_shippable: 7,
      qty_approved: 7,
      state: 'picked',
      confirmed_mrp: 181,
      scan_result: {
        matchStrategy: 'price_group',
        confirmedMrp: 181,
        progress: { pickedQty: 7, remainingQty: 3, targetQty: 10 },
      } as OrderItem['scan_result'],
    });
    const split = stubItem({
      id: 2,
      split_from_id: 1,
      qty_requested: 3,
      qty_shippable: 3,
      qty_approved: 3,
      state: 'picked',
      confirmed_mrp: 181,
      scan_result: {
        matchStrategy: 'price_group',
        confirmedMrp: 181,
        progress: { pickedQty: 10, remainingQty: 0, targetQty: 10 },
      } as OrderItem['scan_result'],
    });

    expect(deriveLineCompletionStatus(root, [root, split])).toBe('picked');
  });
});

describe('deriveCompletedLinesFromOrder', () => {
  it('builds a map for pickable root lines only', () => {
    const root = stubItem({
      id: 1,
      state: 'flagged',
      flag_reason: 'Out of Stock',
    });
    const map = deriveCompletedLinesFromOrder([root], [root]);
    expect(map[1]).toBe('flagged');
  });
});
