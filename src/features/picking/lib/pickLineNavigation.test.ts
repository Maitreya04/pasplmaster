import { describe, expect, it } from 'vitest';
import { findNextPendingLineIndex } from './pickLineNavigation';

describe('findNextPendingLineIndex', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it('skips completed lines', () => {
    expect(findNextPendingLineIndex(items, 0, { 1: 'picked', 2: 'partial' })).toBe(2);
  });

  it('returns null when every line is closed', () => {
    expect(
      findNextPendingLineIndex(items, 1, {
        1: 'picked',
        2: 'partial',
        3: 'flagged',
      }),
    ).toBeNull();
  });
});
