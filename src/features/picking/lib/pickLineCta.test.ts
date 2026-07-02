import { describe, expect, it } from 'vitest';
import {
  derivePickLineUiState,
  pickPrimaryCta,
  pickSecondaryCta,
} from './pickLineCta';

describe('pickLineCta', () => {
  it('derives fresh vs in_progress vs complete', () => {
    expect(derivePickLineUiState(undefined, 0, 10, false)).toBe('fresh');
    expect(derivePickLineUiState(undefined, 4, 10, false)).toBe('in_progress');
    expect(derivePickLineUiState(undefined, 10, 10, true)).toBe('complete');
    expect(derivePickLineUiState('picked', 0, 10, false)).toBe('marked_picked');
    expect(derivePickLineUiState('partial', 1, 2, false)).toBe('in_progress');
  });

  it('uses quantity-specific pick labels without arrows', () => {
    expect(pickPrimaryCta('fresh', 10, 10, 'pcs', 0, 3, false)).toEqual({
      kind: 'pick',
      label: 'Pick 10 pcs',
    });
    expect(pickPrimaryCta('in_progress', 4, 10, 'pcs', 1, 3, false)).toEqual({
      kind: 'pick',
      label: 'Pick 4 more pcs',
    });
  });

  it('uses navigation label with arrow only for next line', () => {
    expect(pickPrimaryCta('marked_picked', 0, 10, 'pcs', 0, 3, false)).toEqual({
      kind: 'next',
      label: 'Next line →',
    });
  });

  it('keeps picking when a partial line still owes qty', () => {
    expect(pickPrimaryCta('marked_partial', 1, 2, 'pcs', 0, 3, false)).toEqual({
      kind: 'pick',
      label: 'Pick 1 more pcs',
    });
    expect(pickPrimaryCta('in_progress', 1, 2, 'pcs', 0, 3, false)).toEqual({
      kind: 'pick',
      label: 'Pick 1 more pcs',
    });
  });

  it('shows edit pick when revisiting a complete line', () => {
    expect(pickPrimaryCta('marked_picked', 0, 10, 'pcs', 0, 3, true)).toEqual({
      kind: 'edit',
      label: 'Edit pick',
    });
    expect(pickSecondaryCta('marked_picked', true, 0, 3)).toEqual({
      kind: 'next',
      label: 'Next line →',
    });
  });

  it('offers finish order on last line', () => {
    expect(pickPrimaryCta('marked_picked', 0, 10, 'pcs', 2, 3, false)).toEqual({
      kind: 'finish',
      label: 'Finish order',
    });
  });
});
