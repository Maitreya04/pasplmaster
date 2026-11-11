import assert from 'node:assert/strict';
import {
  isSupabaseAuthError,
  requestSessionRecovery,
  setSessionRecoveryArmed,
  shouldRecoverSessionFromError,
  registerSessionRecoveryHandler,
} from './authError.ts';

assert.equal(isSupabaseAuthError({ status: 401 }), true);
assert.equal(isSupabaseAuthError({ status: 403, message: 'permission denied' }), true);
assert.equal(isSupabaseAuthError({ message: 'JWT expired' }), true);
assert.equal(isSupabaseAuthError({ status: 500 }), false);
assert.equal(shouldRecoverSessionFromError({ code: 'PGRST301' }), true);
assert.equal(
  shouldRecoverSessionFromError(new Error('Items catalog requires an authenticated session')),
  false,
);

// Disarmed recovery must not invoke the handler (boot / pre-session race).
let called = 0;
registerSessionRecoveryHandler(() => {
  called += 1;
});
setSessionRecoveryArmed(false);
requestSessionRecovery('test');
assert.equal(called, 0);

registerSessionRecoveryHandler(null);
setSessionRecoveryArmed(false);

console.log('authError.test.ts: ok');
