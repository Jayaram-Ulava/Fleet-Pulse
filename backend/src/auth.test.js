import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from './app.js';

async function withServer(run) {
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('operator and viewer can sign in and receive HttpOnly refresh cookies', async () => {
  await withServer(async (baseUrl) => {
    for (const [email, role] of [
      ['operator@pulse.dev', 'operator'],
      ['viewer@pulse.dev', 'viewer'],
    ]) {
      const response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'pulse123' }),
      });

      assert.equal(response.status, 200);
      assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/);
      assert.match(response.headers.get('set-cookie') ?? '', /SameSite=Lax/);

      const body = await response.json();
      assert.ok(body.accessToken.length > 20);
      assert.deepEqual(body.user, {
        id: role === 'operator' ? 'operator-1' : 'viewer-1',
        email,
        role,
      });
    }
  });
});

test('invalid credentials do not create a session', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'operator@pulse.dev', password: 'wrong' }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: { code: 'INVALID_CREDENTIALS' },
    });
  });
});

test('refresh rotates its cookie and rejects reuse of the old token', async () => {
  await withServer(async (baseUrl) => {
    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'viewer@pulse.dev', password: 'pulse123' }),
    });
    const oldCookie = (loginResponse.headers.get('set-cookie') ?? '').split(';')[0];

    const refreshResponse = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: oldCookie },
    });

    assert.equal(refreshResponse.status, 200);
    assert.notEqual((refreshResponse.headers.get('set-cookie') ?? '').split(';')[0], oldCookie);

    const reusedResponse = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: oldCookie },
    });
    assert.equal(reusedResponse.status, 401);
  });
});
