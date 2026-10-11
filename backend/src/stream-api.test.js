import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { createApp } from './app.js';
import { attachMetricWebSocketServer } from './websocket-server.js';

async function withServer(run, includeWebSocket = false) {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const webSocketServer = includeWebSocket ? attachMetricWebSocketServer(server, app) : null;

  try {
    await run({
      app,
      httpUrl: `http://127.0.0.1:${address.port}`,
      webSocketUrl: `ws://127.0.0.1:${address.port}/stream`,
    });
  } finally {
    webSocketServer?.close();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function login(httpUrl) {
  const response = await fetch(`${httpUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'operator@pulse.dev', password: 'pulse123' }),
  });
  return (await response.json()).accessToken;
}

test('GET /metrics/replay returns authenticated events after the requested offset', async () => {
  await withServer(async ({ app, httpUrl }) => {
    const accessToken = await login(httpUrl);
    app.locals.metricStream.generateOne();
    const response = await fetch(`${httpUrl}/metrics/replay?since=0`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].offset, 1);
    assert.equal(body.events[0].type, 'metric');
  });
});

test('SSE endpoint requires authentication and emits metric event framing', async () => {
  await withServer(async ({ app, httpUrl }) => {
    const unauthenticatedResponse = await fetch(`${httpUrl}/stream/sse`);
    assert.equal(unauthenticatedResponse.status, 401);

    const accessToken = await login(httpUrl);
    const abortController = new AbortController();
    const response = await fetch(`${httpUrl}/stream/sse`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: abortController.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);

    const firstEvent = response.body.getReader().read();
    app.locals.metricStream.generateOne();
    const { value } = await firstEvent;
    const eventText = new TextDecoder().decode(value);
    assert.match(eventText, /id: 1/);
    assert.match(eventText, /"type":"metric"/);
    abortController.abort();
  });
});

test('WebSocket stream authenticates bearer subprotocol and delivers metric events', async () => {
  await withServer(async ({ app, httpUrl, webSocketUrl }) => {
    const accessToken = await login(httpUrl);
    const socket = new WebSocket(webSocketUrl, ['fleet-pulse-v1', `bearer.${accessToken}`]);
    await once(socket, 'open');
    assert.equal(socket.protocol, 'fleet-pulse-v1');

    const eventPromise = once(socket, 'message');
    app.locals.metricStream.generateOne();
    const [payload] = await eventPromise;
    const event = JSON.parse(payload.toString());
    assert.equal(event.offset, 1);
    assert.equal(event.type, 'metric');

    const closed = once(socket, 'close');
    socket.close();
    await closed;
  }, true);
});

test('GET /metrics/history returns bounded chart points for a known service', async () => {
  await withServer(async ({ httpUrl }) => {
    const accessToken = await login(httpUrl);
    const response = await fetch(`${httpUrl}/metrics/history?serviceId=svc-0001&minutes=15`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const history = await response.json();

    assert.equal(response.status, 200);
    assert.equal(history.serviceId, 'svc-0001');
    assert.equal(history.minutes, 15);
    assert.ok(history.points.length <= 300);
    assert.ok(history.points.length > 0);
    assert.ok(history.points[0].ts < history.points.at(-1).ts);
  });
});
