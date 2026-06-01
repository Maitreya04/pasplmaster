import assert from 'node:assert/strict';
import {
  customerNameSizeClass,
  isOrderAgeUrgent,
  orderAgePill,
  orderAgeTier,
} from './orderAgeTier';

const BASE = Date.parse('2026-05-31T12:00:00.000Z');

function runTests(): void {
  assert.equal(orderAgePill('2026-05-31T11:45:00.000Z', BASE), null, '15 min — hidden');

  const fortySevenMin = orderAgePill('2026-05-31T11:13:00.000Z', BASE);
  assert.ok(fortySevenMin);
  assert.equal(fortySevenMin.tier, 'warning');
  assert.equal(fortySevenMin.label, '47 min');

  const twoHours = orderAgePill('2026-05-31T10:00:00.000Z', BASE);
  assert.ok(twoHours);
  assert.equal(twoHours.tier, 'warning');
  assert.equal(twoHours.label, '2h ago');

  const sixHours = orderAgePill('2026-05-31T06:00:00.000Z', BASE);
  assert.ok(sixHours);
  assert.equal(sixHours.tier, 'critical');
  assert.equal(sixHours.label, '6h ago');

  const threeDays = orderAgePill('2026-05-28T12:00:00.000Z', BASE);
  assert.ok(threeDays);
  assert.equal(threeDays.tier, 'critical');
  assert.equal(threeDays.label, '3d ago');

  assert.equal(isOrderAgeUrgent('2026-05-31T10:00:00.000Z', BASE), false);
  assert.equal(isOrderAgeUrgent('2026-05-31T06:00:00.000Z', BASE), true);

  const legacy = orderAgeTier('2026-05-31T06:00:00.000Z', BASE);
  assert.equal(legacy.tier, 'critical');
  assert.equal(legacy.label, '6h ago');

  assert.equal(customerNameSizeClass('Shree Balaji Motors'), 'font-ds-lead');
  assert.equal(customerNameSizeClass('Ankur Auto Parts Pvt Ltd'), 'font-ds-body-size');
  assert.equal(
    customerNameSizeClass('Shree Balaji Motors And Spare Parts Depot'),
    'font-ds-prose',
  );

  console.log('orderAgeTier tests passed');
}

runTests();
