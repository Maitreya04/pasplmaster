import assert from 'node:assert/strict';
import { isSupabaseAuthError, shouldRecoverSessionFromError } from './authError.ts';

assert.equal(isSupabaseAuthError({ status: 401 }), true);
assert.equal(isSupabaseAuthError({ status: 403, message: 'permission denied' }), true);
assert.equal(isSupabaseAuthError({ message: 'JWT expired' }), true);
assert.equal(isSupabaseAuthError({ status: 500 }), false);
assert.equal(shouldRecoverSessionFromError({ code: 'PGRST301' }), true);
console.log('authError.test.ts: ok');
