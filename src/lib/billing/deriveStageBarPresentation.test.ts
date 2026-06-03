import assert from 'node:assert/strict';
import { deriveStageBarPresentation } from './deriveStageBarPresentation';

function runTests(): void {
  const busy = deriveStageBarPresentation({
    stage: 'busy_entry',
    busyProgress: { entered: 2, total: 6 },
  });
  const busyActive = busy.steps.find((s) => s.isActive);
  assert.ok(busyActive);
  assert.equal(busyActive.label, 'Busy entry');
  assert.equal(busyActive.modifier, 'neutral');

  const noPick = deriveStageBarPresentation({
    stage: 'busy_entry',
    skipWarehousePick: true,
  });
  const noPickActive = noPick.steps.find((s) => s.isActive);
  assert.ok(noPickActive);
  assert.equal(noPickActive!.label, 'Busy entry · no pick');
  const assignStep = noPick.steps.find((s) => s.id === 'assign_picker');
  const pickingStep = noPick.steps.find((s) => s.id === 'picking');
  assert.ok(assignStep?.isSkipped);
  assert.ok(pickingStep?.isSkipped);

  const picking = deriveStageBarPresentation({
    stage: 'picking',
    editCount: 3,
  });
  const pickActive = picking.steps.find((s) => s.isActive);
  assert.ok(pickActive);
  assert.equal(pickActive.label, 'Picking · 3 edits');
  assert.equal(pickActive.modifier, 'warning');

  const pickProgress = deriveStageBarPresentation({
    stage: 'picking',
    pickProgress: { total: 24, picked: 8, flagged: 2, done: 10, remaining: 14 },
  });
  const progressActive = pickProgress.steps.find((s) => s.isActive);
  assert.ok(progressActive);
  assert.equal(progressActive!.label, 'Picking · 10/24 · 2 flagged');
  assert.equal(progressActive!.modifier, 'warning');

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
