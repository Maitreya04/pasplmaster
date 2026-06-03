import assert from 'node:assert/strict';
import { derivePickingMonitorPresentation } from './pickingMonitorPresentation';

function runTests(): void {
  const notStarted = derivePickingMonitorPresentation({
    deskStatus: 'no_ack',
    pickingClaimStale: false,
    pickerName: 'Harsh Kumar',
    workflowStatus: 'approved',
    progress: { total: 24, picked: 0, flagged: 0, done: 0, remaining: 24 },
  });
  assert.equal(notStarted.contextNotStarted, true);
  assert.equal(notStarted.banner?.variant, 'not_started');

  const activityNoClaim = derivePickingMonitorPresentation({
    deskStatus: 'no_ack',
    pickingClaimStale: false,
    pickerName: 'Harsh',
    workflowStatus: 'approved',
    progress: { total: 24, picked: 3, flagged: 0, done: 3, remaining: 21 },
  });
  assert.equal(activityNoClaim.contextNotStarted, false);
  assert.equal(activityNoClaim.banner?.variant, 'activity_without_claim');

  const active = derivePickingMonitorPresentation({
    deskStatus: 'picking',
    pickingClaimStale: false,
    pickerName: 'Harsh',
    workflowStatus: 'picking',
    progress: { total: 10, picked: 4, flagged: 1, done: 5, remaining: 5 },
  });
  assert.equal(active.contextNotStarted, false);
  assert.equal(active.banner, null);

  console.log('pickingMonitorPresentation.test.ts: all passed');
}

runTests();
