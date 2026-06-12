import assert from 'node:assert/strict';
import test from 'node:test';
import { pickerBillingHandoffLine } from './pickerBillingHandoff';

test('pickerBillingHandoffLine clean pick sets notify expectation', () => {
  assert.equal(
    pickerBillingHandoffLine(false),
    "Take to billing desk — you'll be notified when the bill is ready",
  );
});

test('pickerBillingHandoffLine flagged pick sets resolve notify expectation', () => {
  assert.equal(
    pickerBillingHandoffLine(true),
    'Take to billing desk — billing will resolve and notify you',
  );
});
