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

async function login(baseUrl) {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'operator@pulse.dev', password: 'pulse123' }),
  });
  return (await response.json()).accessToken;
}

test('service inventory and metric snapshots require an access token', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/services`);
    assert.equal(response.status, 401);
  });
});

test('authenticated fleet endpoints return matching inventory and snapshot IDs', async () => {
  await withServer(async (baseUrl) => {
    const accessToken = await login(baseUrl);
    const headers = { authorization: `Bearer ${accessToken}` };
    const servicesResponse = await fetch(`${baseUrl}/services`, { headers });
    const snapshotResponse = await fetch(`${baseUrl}/metrics/snapshot`, { headers });
    const services = (await servicesResponse.json()).services;
    const snapshot = await snapshotResponse.json();

    assert.equal(servicesResponse.status, 200);
    assert.equal(snapshotResponse.status, 200);
    assert.equal(services.length, 2_000);
    assert.equal(snapshot.services.length, 2_000);
    assert.equal(services[0].serviceId, snapshot.services[0].serviceId);
    assert.equal(services[1_999].serviceId, snapshot.services[1_999].serviceId);
  });
});
