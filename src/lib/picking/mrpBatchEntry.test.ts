import assert from 'node:assert/strict';
import { validatePickMrpBatchInput } from './mrpBatchEntry.ts';

function valid(priceInput: string, qtyInput: string, remainingQty: number): [number, number] {
  const result = validatePickMrpBatchInput({ priceInput, qtyInput, remainingQty });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(result.error);
  return [result.price, result.qty];
}

assert.deepEqual(valid('1355', '8', 8), [1355, 8]);
assert.deepEqual(valid('1299', '5', 8), [1299, 5]);

assert.equal(
  validatePickMrpBatchInput({ priceInput: '', qtyInput: '5', remainingQty: 8 }).ok,
  false,
);
assert.equal(
  validatePickMrpBatchInput({ priceInput: '1355', qtyInput: '0', remainingQty: 8 }).ok,
  false,
);
assert.deepEqual(
  validatePickMrpBatchInput({ priceInput: '1355', qtyInput: '9', remainingQty: 8 }),
  { ok: false, error: 'Only 8 pcs left on this line.' },
);

console.log('mrpBatchEntry tests passed');
