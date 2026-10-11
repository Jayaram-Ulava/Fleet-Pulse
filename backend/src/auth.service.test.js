import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthService } from './auth.js';

test('logout revokes all access and refresh tokens for the user', () => {
  const auth = createAuthService(() => 1_000);
  const session = auth.login('operator@pulse.dev', 'pulse123');
  assert.ok(session);
  assert.equal(auth.authenticate(session.accessToken)?.role, 'operator');

  auth.revoke(session.refreshToken);

  assert.equal(auth.authenticate(session.accessToken), null);
  assert.equal(auth.refresh(session.refreshToken), null);
});
