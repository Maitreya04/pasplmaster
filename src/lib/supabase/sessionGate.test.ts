import assert from 'node:assert/strict';
import { isSessionLocallyValid } from './sessionValidity.ts';
import type { Session } from '@supabase/supabase-js';

function sessionFixture(overrides: Partial<Session> = {}): Session {
  return {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600,
    token_type: 'bearer',
    user: { id: 'u1' } as Session['user'],
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

assert.equal(isSessionLocallyValid(null), false);
assert.equal(isSessionLocallyValid(undefined), false);
assert.equal(isSessionLocallyValid(sessionFixture({ access_token: '' })), false);
assert.equal(isSessionLocallyValid(sessionFixture()), true);
assert.equal(
  isSessionLocallyValid(sessionFixture({ expires_at: Math.floor(Date.now() / 1000) - 10 })),
  false,
);
assert.equal(isSessionLocallyValid(sessionFixture({ expires_at: undefined })), true);

console.log('sessionGate.test.ts: ok');
