import assert from 'node:assert/strict';
import {
  busyFinishEnabledLabel,
  busySheetSummaryParts,
  deriveBusyFinishAction,
  isSkipWarehousePick,
} from './busyFinishAction';

// Gate: not all ticked
{
  const a = deriveBusyFinishAction({
    billableCount: 5,
    enteredCount: 3,
    skipCount: 0,
  });
  assert.equal(a.disabled, true);
  assert.equal(a.label, 'Done — assign picker');
  assert.equal(a.gateWarning, 'Tick 2 more items in Busy');
  assert.equal(a.hint, null);
}

// Ready with pending skips
{
  const a = deriveBusyFinishAction({
    billableCount: 5,
    enteredCount: 5,
    skipCount: 2,
  });
  assert.equal(a.disabled, false);
  assert.equal(a.label, 'Done — assign picker');
  assert.equal(a.gateWarning, null);
  assert.equal(a.hint, null);
}

// Ready, clean sheet
{
  const a = deriveBusyFinishAction({
    billableCount: 5,
    enteredCount: 5,
    skipCount: 0,
  });
  assert.equal(a.disabled, false);
  assert.equal(a.hint, null);
}

// All lines pending — no warehouse pick
{
  assert.equal(isSkipWarehousePick(0, 1), true);
  assert.equal(busyFinishEnabledLabel(0, 1), 'Done — record pending');

  const a = deriveBusyFinishAction({
    billableCount: 0,
    enteredCount: 0,
    skipCount: 1,
  });
  assert.equal(a.disabled, false);
  assert.equal(a.label, 'Done — record pending');
  assert.equal(a.hint, 'Nothing to bill today · no warehouse pick');
}

// Summary uses operator language
{
  const parts = busySheetSummaryParts({
    billableCount: 5,
    skipCount: 2,
    editCount: 0,
    removedCount: 0,
    addedCount: 0,
  });
  assert.deepEqual(parts, ['5 to bill', '2 pending']);
}

{
  const parts = busySheetSummaryParts({
    billableCount: 0,
    skipCount: 1,
    editCount: 0,
    removedCount: 0,
    addedCount: 0,
  });
  assert.deepEqual(parts, ['Nothing to bill today', '1 pending']);
}

console.log('busyFinishAction.test.ts: ok');
