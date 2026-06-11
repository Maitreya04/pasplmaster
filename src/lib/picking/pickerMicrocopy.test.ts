import { describe, expect, it } from 'vitest';
import {
  gapHeroSubLabel,
  qtyCtaLabel,
  qtyFeedbackText,
  uomLabel,
  uomOrderedLabel,
} from './pickerMicrocopy';

describe('uomLabel', () => {
  it('singularizes for n=1', () => {
    expect(uomLabel('SET', 1)).toBe('set');
    expect(uomLabel('PAIR', 1)).toBe('pair');
  });

  it('pluralizes pairs and pcs', () => {
    expect(uomLabel('PAIR', 3)).toBe('pairs');
    expect(uomLabel('PCS', 5)).toBe('pcs');
    expect(uomLabel('SET', 2)).toBe('sets');
  });
});

describe('qtyFeedbackText', () => {
  it('shows remaining for partial batch', () => {
    expect(qtyFeedbackText('partial', 8, 10, 'SET', 0)).toBe('2 sets still to log');
  });

  it('shows over copy', () => {
    expect(qtyFeedbackText('over', 5, 1, 'PAIR', 0)).toBe('Over order by 4 pairs');
  });
});

describe('qtyCtaLabel', () => {
  it('gates over without note', () => {
    expect(qtyCtaLabel('over', 5, 255, 'PAIR', false)).toBe('Add a note first →');
  });

  it('shows commit sentence when ready', () => {
    expect(qtyCtaLabel('exact', 10, 664, 'SET', false)).toBe('10 sets @ ₹664 ✓');
  });
});

describe('gapHeroSubLabel', () => {
  it('shows unlogged remaining', () => {
    expect(gapHeroSubLabel(2, 10, 'SET')).toBe('2 sets still unlogged');
  });

  it('shows complete message', () => {
    expect(gapHeroSubLabel(0, 10, 'SET')).toBe('All 10 sets logged ✓');
  });
});

describe('uomOrderedLabel', () => {
  it('uses singular ordered form', () => {
    expect(uomOrderedLabel('PAIR')).toBe('pair ordered');
  });
});
