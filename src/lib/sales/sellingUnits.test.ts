import assert from 'node:assert/strict';
import {
  autoSelectUnitId,
  DEFAULT_SALES_SELLING_UNITS,
  DEFAULT_SALES_UNIT_ID,
  parseSalesSellingUnits,
  qtyToEa,
  salesUnitsForItem,
  stockQtyInSalesUnit,
} from './sellingUnits';
import type { Item } from '../../types';

const kitSetItem: Pick<Item, 'sales_selling_units'> = {
  sales_selling_units: [
    { id: 'kit', label: 'Kit', busy_unit: 'Kit', ea_multiplier: 1 },
    { id: 'set', label: 'Set', busy_unit: 'Set', ea_multiplier: 4 },
    { id: 'nos', label: 'Nos', busy_unit: 'Nos', ea_multiplier: 0.25 },
  ],
};

assert.equal(parseSalesSellingUnits(null).length, 0);
assert.equal(salesUnitsForItem({}).length, 3);
assert.deepEqual(
  salesUnitsForItem({}).map((u) => u.id),
  DEFAULT_SALES_SELLING_UNITS.map((u) => u.id),
);
assert.equal(autoSelectUnitId({}), DEFAULT_SALES_UNIT_ID);
assert.equal(autoSelectUnitId(kitSetItem), DEFAULT_SALES_UNIT_ID);
assert.equal(
  autoSelectUnitId({ sales_selling_units: [{ id: 'kit', label: 'Kit', ea_multiplier: 1 }] }),
  'kit',
);

assert.equal(qtyToEa(kitSetItem, 2, 'set'), 8);
assert.equal(qtyToEa(kitSetItem, 3, 'kit'), 3);
assert.equal(stockQtyInSalesUnit(76, kitSetItem, 'kit'), 76);
assert.equal(stockQtyInSalesUnit(76, kitSetItem, 'set'), 19);

console.log('sellingUnits tests passed');
