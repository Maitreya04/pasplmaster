import assert from 'node:assert/strict';
import { busySheetSummaryParts, deriveBusyFinishAction } from './busyFinishAction';

// Gate: not all ticked
{
  const a = deriveBusyFinishAction({
    billableCount: 5,
    enteredCount: 3,
    skipCount: 0,
  });
  assert.equal(a.disabled, true);
  assert.equal(a.label, 'Done — assign picker');
  assert.equal(a.gateWarning, 'Tick 2 more lines in Busy');
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

console.log('busyFinishAction.test.ts: ok');
