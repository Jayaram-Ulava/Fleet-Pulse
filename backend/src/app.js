import express from 'express';
import { createAuthService } from './auth.js';
import { createFleetData } from './fleet-data.js';
import { createMetricStream } from './metric-stream.js';
import { createRuleStore, validateRulePayload } from './rule-store.js';

const REFRESH_COOKIE_NAME = 'fleet_pulse_refresh';
const REFRESH_COOKIE_PATH = '/api/auth';
const REFRESH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const STREAM_HEARTBEAT_INTERVAL_MS = 5_000;

function readCookie(request, cookieName) {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));

  return cookie ? cookie.slice(cookieName.length + 1) : null;
}

function setRefreshCookie(response, refreshToken) {
  const cookieParts = [
    `${REFRESH_COOKIE_NAME}=${refreshToken}`,
    `Path=${REFRESH_COOKIE_PATH}`,
    `Max-Age=${REFRESH_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (process.env.NODE_ENV === 'production') {
    cookieParts.push('Secure');
  }

  response.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearRefreshCookie(response) {
  response.setHeader(
    'Set-Cookie',
    `${REFRESH_COOKIE_NAME}=; Path=${REFRESH_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`,
  );
}

export function createApp() {
  const app = express();
  const authService = createAuthService();
  const fleetData = createFleetData();
  const metricStream = createMetricStream(fleetData);
  const ruleStore = createRuleStore();
  app.locals.authService = authService;
  app.locals.metricStream = metricStream;
  app.locals.ruleStore = ruleStore;

  app.disable('x-powered-by');
  app.use(express.json());
  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.post('/auth/login', (request, response) => {
    const { email, password } = request.body ?? {};

    if (typeof email !== 'string' || typeof password !== 'string') {
      response.status(400).json({ error: { code: 'INVALID_REQUEST' } });
      return;
    }

    const session = authService.login(email.trim().toLowerCase(), password);
    if (!session) {
      response.status(401).json({ error: { code: 'INVALID_CREDENTIALS' } });
      return;
    }

    setRefreshCookie(response, session.refreshToken);
    response.status(200).json({ accessToken: session.accessToken, user: session.user });
  });

  app.post('/auth/refresh', (request, response) => {
    const refreshToken = readCookie(request, REFRESH_COOKIE_NAME);
    const session = refreshToken ? authService.refresh(refreshToken) : null;

    if (!session) {
      clearRefreshCookie(response);
      response.status(401).json({ error: { code: 'INVALID_REFRESH_TOKEN' } });
      return;
    }

    setRefreshCookie(response, session.refreshToken);
    response.status(200).json({ accessToken: session.accessToken, user: session.user });
  });

  app.post('/auth/logout', (request, response) => {
    authService.revoke(readCookie(request, REFRESH_COOKIE_NAME));
    clearRefreshCookie(response);
    response.status(204).end();
  });

  app.get('/rules', (request, response) => {
    const user = authenticatedUser(request, authService);
    if (!user) {
      response.status(401).json({ error: { code: 'ACCESS_TOKEN_EXPIRED' } });
      return;
    }

    response.status(200).json({ rules: ruleStore.list() });
  });

  app.get('/rules/check-name', (request, response) => {
    const user = authenticatedUser(request, authService);
    if (!user) {
      response.status(401).json({ error: { code: 'ACCESS_TOKEN_EXPIRED' } });
      return;
    }

    const name = request.query['name'];
    const excludeId = request.query['excludeId'];
    if (typeof name !== 'string' || name.trim().length === 0) {
      response.status(400).json({ error: { code: 'INVALID_RULE_NAME' } });
      return;
    }

    response.status(200).json({
      available: !ruleStore.nameExists(name, typeof excludeId === 'string' ? excludeId : null),
    });
  });

  app.get('/rules/:id', (request, response) => {
    const user = authenticatedUser(request, authService);
    if (!user) {
      response.status(401).json({ error: { code: 'ACCESS_TOKEN_EXPIRED' } });
      return;
    }

    const rule = ruleStore.get(request.params['id']);
    if (!rule) {
      response.status(404).json({ error: { code: 'RULE_NOT_FOUND' } });
      return;
    }

    response.status(200).json(rule);
  });

  app.post('/rules', (request, response) => {
    const user = authenticatedUser(request, authService);
    if (!user) {
      response.status(401).json({ error: { code: 'ACCESS_TOKEN_EXPIRED' } });
      return;
    }
    if (user.role !== 'operator') {
      response.status(403).json({ error: { code: 'OPERATOR_ROLE_REQUIRED' } });
      return;
    }

    const idempotencyKey = request.get('Idempotency-Key');
    if (!isUuid(idempotencyKey) || !validateRulePayload(request.body)) {
      response.status(400).json({ error: { code: 'INVALID_RULE_REQUEST' } });
      return;
    }
    const replay = ruleStore.checkIdempotencyKey(idempotencyKey, request.body);
    if (replay?.conflict) {
      response.status(409).json({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
      return;
    }
    if (replay?.replayed) {
      response.status(200).json(replay.rule);
      return;
    }
    if (ruleStore.nameExists(request.body.name)) {
      response.status(409).json({ error: { code: 'RULE_NAME_TAKEN' } });
      return;
    }

    const result = ruleStore.create(request.body, idempotencyKey);
    if (result.conflict) {
      response.status(409).json({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
      return;
    }

    response.status(result.replayed ? 200 : 201).json(result.rule);
  });

  app.put('/rules/:id', (request, response) => {
    const user = authenticatedUser(request, authService);
    if (!user) {
      response.status(401).json({ error: { code: 'ACCESS_TOKEN_EXPIRED' } });
      return;
    }
    if (user.role !== 'operator') {
      response.status(403).json({ error: { code: 'OPERATOR_ROLE_REQUIRED' } });
      return;
    }
    if (!validateRulePayload(request.body)) {
      response.status(400).json({ error: { code: 'INVALID_RULE_REQUEST' } });
      return;
    }
    if (ruleStore.nameExists(request.body.name, request.params['id'])) {
      response.status(409).json({ error: { code: 'RULE_NAME_TAKEN' } });
      return;
    }

    const rule = ruleStore.update(request.params['id'], request.body);
    if (!rule) {
      response.status(404).json({ error: { code: 'RULE_NOT_FOUND' } });
      return;
    }
    response.status(200).json(rule);
  });

  app.delete('/rules/:id', (request, response) => {
    const user = authenticatedUser(request, authService);
    if (!user) {
      response.status(401).json({ error: { code: 'ACCESS_TOKEN_EXPIRED' } });
      return;
    }
    if (user.role !== 'operator') {
      response.status(403).json({ error: { code: 'OPERATOR_ROLE_REQUIRED' } });
      return;
    }
    if (!ruleStore.delete(request.params['id'])) {
      response.status(404).json({ error: { code: 'RULE_NOT_FOUND' } });
      return;
    }
    response.status(204).end();
  });

  app.get('/services', (request, response) => {
    const user = authenticatedUser(request, authService);
    if (!user) {
      response.status(401).json({ error: { code: 'ACCESS_TOKEN_EXPIRED' } });
      return;
    }

    response.status(200).json({ services: fleetData.listServices() });
  });

  app.get('/metrics/snapshot', (request, response) => {
    const user = authenticatedUser(request, authService);
    if (!user) {
      response.status(401).json({ error: { code: 'ACCESS_TOKEN_EXPIRED' } });
      return;
    }

    response.status(200).json(metricStream.snapshot());
  });

  app.get('/metrics/history', (request, response) => {
    const user = authenticatedUser(request, authService);
    if (!user) {
      response.status(401).json({ error: { code: 'ACCESS_TOKEN_EXPIRED' } });
      return;
    }

    const serviceId = request.query['serviceId'];
    const minutes = Number(request.query['minutes'] ?? 15);
    if (
      typeof serviceId !== 'string' ||
      serviceId.length === 0 ||
      !Number.isSafeInteger(minutes) ||
      minutes < 1 ||
      minutes > 60
    ) {
      response.status(400).json({ error: { code: 'INVALID_HISTORY_REQUEST' } });
      return;
    }

    const history = metricStream.historyForService(serviceId, minutes);
    if (!history) {
      response.status(404).json({ error: { code: 'SERVICE_NOT_FOUND' } });
      return;
    }

    response.status(200).json(history);
  });

  app.get('/metrics/replay', (request, response) => {
    const user = authenticatedUser(request, authService);
    if (!user) {
      response.status(401).json({ error: { code: 'ACCESS_TOKEN_EXPIRED' } });
      return;
    }

    const sinceOffset = Number(request.query['since']);
    if (!Number.isSafeInteger(sinceOffset) || sinceOffset < 0) {
      response.status(400).json({ error: { code: 'INVALID_OFFSET' } });
      return;
    }

    const events = metricStream.replay(sinceOffset);
    if (!events) {
      response.status(410).json({ error: { code: 'HISTORY_EXPIRED' } });
      return;
    }

    response.status(200).json({ events });
  });

  app.get('/stream/sse', (request, response) => {
    const user = authenticatedUser(request, authService);
    if (!user) {
      response.status(401).json({ error: { code: 'ACCESS_TOKEN_EXPIRED' } });
      return;
    }

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    const unsubscribe = metricStream.subscribe((event) => {
      response.write(`id: ${event.offset}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeatTimer = setInterval(
      () => response.write(': heartbeat\n\n'),
      STREAM_HEARTBEAT_INTERVAL_MS,
    );
    request.on('close', () => {
      clearInterval(heartbeatTimer);
      unsubscribe();
    });
  });

  return app;
}

export function authenticatedUser(request, authService) {
  const authorization = request.get('authorization');
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearerToken ? authService.authenticate(bearerToken) : null;
}

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
  );
}
