import assert from 'node:assert/strict';
import { deriveStageBarPresentation } from './deriveStageBarPresentation';

function runTests(): void {
  const busy = deriveStageBarPresentation({
    stage: 'busy_entry',
    busyProgress: { entered: 2, total: 6 },
  });
  const busyActive = busy.steps.find((s) => s.isActive);
  assert.ok(busyActive);
  assert.equal(busyActive.label, 'Busy entry · 2/6');
  assert.equal(busyActive.modifier, 'warning');

  const picking = deriveStageBarPresentation({
    stage: 'picking',
    editCount: 3,
  });
  const pickActive = picking.steps.find((s) => s.isActive);
  assert.ok(pickActive);
  assert.equal(pickActive.label, 'Picking · 3 edits');
  assert.equal(pickActive.modifier, 'warning');

  const critical = deriveStageBarPresentation({
    stage: 'picking',
    allLinesRemoved: true,
  });
  const critActive = critical.steps.find((s) => s.isActive);
  assert.ok(critActive);
  assert.equal(critActive.modifier, 'critical');

  const done = deriveStageBarPresentation({ stage: 'done' });
  assert.equal(done.barDoneTint, true);

  console.log('deriveStageBarPresentation tests passed');
}

runTests();
