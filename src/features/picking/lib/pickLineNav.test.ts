import { describe, expect, it } from 'vitest';
import { PICK_LINE_CHIP_MAX, usePickLineChipStrip } from './pickLineNav';

describe('pickLineNav', () => {
  it('shows chip strip for small orders only', () => {
    expect(PICK_LINE_CHIP_MAX).toBe(8);
    expect(usePickLineChipStrip(3)).toBe(true);
    expect(usePickLineChipStrip(8)).toBe(true);
    expect(usePickLineChipStrip(9)).toBe(false);
    expect(usePickLineChipStrip(50)).toBe(false);
  });
});
