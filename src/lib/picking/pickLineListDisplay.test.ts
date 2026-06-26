import { describe, expect, it } from 'vitest';
import {
  groupPickLinesByRack,
  truncatePickDescription,
  formatPickLineTotalPrice,
} from './pickLineListDisplay';
import type { PickLineListEntry } from './pickLineListDisplay';

function row(partial: Partial<PickLineListEntry> & Pick<PickLineListEntry, 'itemId' | 'partCode'>): PickLineListEntry {
  return {
    rackNo: 'NGF-4',
    itemName: 'Sample item name',
    targetQty: 1,
    uom: 'PCS',
    status: 'pending',
    ...partial,
  };
}

describe('groupPickLinesByRack', () => {
  it('groups consecutive rows with the same rack', () => {
    const groups = groupPickLinesByRack([
      row({ itemId: 1, partCode: 'A', rackNo: 'NGF-4' }),
      row({ itemId: 2, partCode: 'B', rackNo: 'NGF-4' }),
      row({ itemId: 3, partCode: 'C', rackNo: 'C2' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.rackLabel).toBe('NGF-4');
    expect(groups[0]?.rows).toHaveLength(2);
    expect(groups[1]?.rackLabel).toBe('C2');
  });
});

describe('truncatePickDescription', () => {
  it('truncates long descriptions at word boundaries', () => {
    const text = 'Balaji CT100 Brake Shoe Assembly Front';
    expect(truncatePickDescription(text, 28)).toBe('Balaji CT100 Brake Shoe…');
  });
});

describe('formatPickLineTotalPrice', () => {
  it('formats qty × unit price', () => {
    expect(formatPickLineTotalPrice(10, 864)).toBe('₹8,640');
  });
});
