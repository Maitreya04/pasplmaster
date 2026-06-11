import { offlinePickStatusFromResult } from './offlinePickResult.ts';

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

assertEqual(
  offlinePickStatusFromResult({ success: true, status: 'applied' }),
  'applied',
  'applied result maps to applied',
);

assertEqual(
  offlinePickStatusFromResult({ success: true, status: 'already_applied' }),
  'applied',
  'already_applied result maps to applied',
);

assertEqual(
  offlinePickStatusFromResult({ success: false, status: 'conflict', reason: 'claim_lost' }),
  'conflict',
  'conflict result maps to conflict',
);

assertEqual(
  offlinePickStatusFromResult({ success: false, status: 'failed', error: 'boom' }),
  'failed',
  'failed result maps to failed',
);

console.log('offlinePickResult tests passed');
