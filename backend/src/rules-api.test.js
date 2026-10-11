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

async function login(baseUrl, email) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pulse123' }),
  });
  return (await response.json()).accessToken;
}

const rulePayload = {
  name: 'Checkout latency',
  conditions: [{ metric: 'p95', operator: '>', threshold: 800, durationSeconds: 60 }],
};
const idempotencyKey = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

test('viewers can read rules but cannot create rules', async () => {
  await withServer(async (baseUrl) => {
    const token = await login(baseUrl, 'viewer@pulse.dev');
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };

    assert.equal((await fetch(`${baseUrl}/rules`, { headers })).status, 200);
    assert.equal(
      (
        await fetch(`${baseUrl}/rules`, {
          method: 'POST',
          headers,
          body: JSON.stringify(rulePayload),
        })
      ).status,
      403,
    );
  });
});

test('operator rule creation is idempotent and enforces metric ranges', async () => {
  await withServer(async (baseUrl) => {
    const token = await login(baseUrl, 'operator@pulse.dev');
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };
    const firstResponse = await fetch(`${baseUrl}/rules`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rulePayload),
    });
    const firstRule = await firstResponse.json();
    const retryResponse = await fetch(`${baseUrl}/rules`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rulePayload),
    });
    const retriedRule = await retryResponse.json();

    assert.equal(firstResponse.status, 201);
    assert.equal(retryResponse.status, 200);
    assert.equal(retriedRule.id, firstRule.id);
    assert.equal((await (await fetch(`${baseUrl}/rules`, { headers })).json()).rules.length, 1);

    const invalidResponse = await fetch(`${baseUrl}/rules`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
      body: JSON.stringify({
        ...rulePayload,
        name: 'Impossible error rate',
        conditions: [{ metric: 'errRate', operator: '>', threshold: 101, durationSeconds: 5 }],
      }),
    });
    assert.equal(invalidResponse.status, 400);
  });
});

test('rule name validation is case insensitive and excludes the edited rule', async () => {
  await withServer(async (baseUrl) => {
    const token = await login(baseUrl, 'operator@pulse.dev');
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    };
    const createResponse = await fetch(`${baseUrl}/rules`, {
      method: 'POST',
      headers,
      body: JSON.stringify(rulePayload),
    });
    const rule = await createResponse.json();

    const duplicate = await fetch(`${baseUrl}/rules/check-name?name=CHECKOUT%20LATENCY`, {
      headers,
    });
    const editing = await fetch(
      `${baseUrl}/rules/check-name?name=Checkout%20latency&excludeId=${rule.id}`,
      { headers },
    );

    assert.equal((await duplicate.json()).available, false);
    assert.equal((await editing.json()).available, true);
  });
});
