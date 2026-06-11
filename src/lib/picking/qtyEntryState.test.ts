import { describe, expect, it } from 'vitest';
import {
  getQtyState,
  isExtremeOverTarget,
  isQtyCtaDisabled,
  qtyRemainingAfterBatch,
} from './qtyEntryState';

describe('getQtyState', () => {
  it('returns empty for zero or missing qty', () => {
    expect(getQtyState(0, 10)).toBe('empty');
  });

  it('returns partial when below target', () => {
    expect(getQtyState(3, 10)).toBe('partial');
  });

  it('returns exact when equal to target', () => {
    expect(getQtyState(10, 10)).toBe('exact');
  });

  it('returns over when above target', () => {
    expect(getQtyState(12, 10)).toBe('over');
  });
});

describe('isQtyCtaDisabled', () => {
  it('disables when empty', () => {
    expect(isQtyCtaDisabled('empty', '')).toBe(true);
  });

  it('disables over without note', () => {
    expect(isQtyCtaDisabled('over', '')).toBe(true);
    expect(isQtyCtaDisabled('over', '   ')).toBe(true);
  });

  it('allows over with note', () => {
    expect(isQtyCtaDisabled('over', 'extra in bin')).toBe(false);
  });
});

describe('qtyRemainingAfterBatch', () => {
  it('computes remaining after logged and batch', () => {
    expect(qtyRemainingAfterBatch(10, 3, 4)).toBe(3);
    expect(qtyRemainingAfterBatch(10, 10, 1)).toBe(0);
  });
});

describe('isExtremeOverTarget', () => {
  it('flags 3x or more as extreme', () => {
    expect(isExtremeOverTarget(30, 10)).toBe(true);
    expect(isExtremeOverTarget(15, 10)).toBe(false);
  });
});
