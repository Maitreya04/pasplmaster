import { describe, expect, it } from 'vitest';
import { pickQtyOrderCopy, pickQtyStripCopy, pickQtyVariance } from './pickQtyDisplay';

describe('pickQtyVariance', () => {
  it('detects over-pick', () => {
    expect(pickQtyVariance(12, 5)).toEqual({
      isOver: true,
      isUnder: false,
      isExact: false,
      delta: 7,
    });
  });
});

describe('pickQtyOrderCopy', () => {
  it('calls out extra qty above order', () => {
    expect(pickQtyOrderCopy(12, 5, 'pcs')).toBe('12 logged · 5 on order (+7 extra)');
  });

  it('calls out short pick', () => {
    expect(pickQtyOrderCopy(7, 10, 'pcs')).toBe('7 of 10 pcs on order');
  });
});

describe('pickQtyStripCopy', () => {
  it('shows over-pick in footer strip', () => {
    expect(pickQtyStripCopy(12, 5, 'pcs')).toBe(
      'Line complete · 12 logged (+7 over 5 on order)',
    );
  });
});
