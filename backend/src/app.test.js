import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from './app.js';

test('GET /health returns an explicit healthy response', async (context) => {
  const server = createApp().listen(0, '127.0.0.1');
  context.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});
