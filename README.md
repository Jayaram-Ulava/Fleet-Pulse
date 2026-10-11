# Fleet Pulse

Fleet Pulse is an Angular 21.2 and Express operations dashboard in a single npm-workspace repository. Implemented slices include authentication, a 2,000-service fleet snapshot, virtualized search/filter/sort, resilient live transports and replay, lazy service detail charts, operator alert-rule CRUD/evaluation, an incident panel, and template-driven settings.

## Requirements

- Node.js 22.12+ and npm 10.9.2+
- Docker with the Compose plugin for container startup (optional)

The frontend uses strict TypeScript, Angular Material, Sass, RxJS, Vitest, and Chart.js (loaded only by the lazy detail route). ESLint with angular-eslint is configured for Angular; the backend uses Express 5, `ws`, and Node's built-in test runner.

## Run locally

```bash
npm ci
npm run dev --workspace @fleet-pulse/backend
```

In a second terminal:

```bash
npm start
```

Open `http://localhost:4200`. The Angular dev server proxies `/api/*` to port 3000 and forwards WebSocket upgrades at `/stream`. The backend listens on port 3000.

### Demo accounts

- Operator: `operator@pulse.dev` / `pulse123`
- Viewer: `viewer@pulse.dev` / `pulse123`

`POST /auth/login` accepts `{ "email": "...", "password": "..." }` and returns `{ "accessToken": "...", "user": { "id": "...", "email": "...", "role": "operator|viewer" } }`. The access token is held only in Angular memory. The backend sets a rotating HttpOnly refresh cookie; `POST /auth/refresh` renews the in-memory access token. Logout clears the cookie and revokes the user's mock tokens. These response fields are implementation assumptions because the assignment PDF was not included in the workspace; confirm them against the source PDF before claiming exact contract parity.

Current data endpoints include `GET /services`, `GET /metrics/snapshot`, `GET /metrics/history?serviceId=svc-0001&minutes=15`, and `GET /metrics/replay?since=0`. All require an access token. The history endpoint returns generated sample history, not persisted production telemetry.

Rules endpoints include `GET /rules`, `GET /rules/:id`, `POST /rules`, `PUT /rules/:id`, `DELETE /rules/:id`, and `GET /rules/check-name?name=...&excludeId=...`. Mutations require the operator role; creates require a UUID `Idempotency-Key`. The current incident panel is client-side and does not have a separate persistence API.

## Commands

```bash
npm run build
npm test
npm run lint
npm run format:check
```

`npm test` runs Angular/Vitest and backend/Node tests. To run Angular's lint target directly, run `npx ng lint` from `frontend/`.

## Docker Compose

```bash
docker compose up --build
```

The frontend is exposed at `http://localhost:4200`; the backend health endpoint is `http://localhost:3000/health`. Compose waits for the backend health check before starting the frontend. Docker was unavailable in the development environment, so Compose has not yet been executed here.

## Architecture

- `frontend/src/app/core/` owns authentication, route guards, typed API access, transport state, stream integrity, and diagnostics; `features/` owns lazy route-level pages.
- `frontend/src/app/features/dashboard/` separates dashboard/query state from the CDK virtualized service table.
- `frontend/src/app/features/services/` owns the detail route, chart components, and bounded series downsampling.
- `frontend/src/app/features/rules/` owns the FormArray editor and client-side rule workflow; `core/connection/rule-evaluation.service.ts` is the shared duration-aware evaluator.
- `frontend/src/app/core/settings/` owns browser-safe preferences consumed by polling, row density, and incident visibility.
- `backend/src/` owns Express setup, mock auth, generated fleet data, replay history, SSE, and WebSocket upgrades.
- Root npm workspaces share `package-lock.json` for reproducible installs.
- `frontend/src/environments/environment.ts` defines the API and stream base paths. The dev proxy and nginx config keep backend hostnames out of Angular code.

Stream pipeline:

```text
WebSocket -> SSE -> 2-second polling
	|        |          |
	+---- transport manager ----> event validation/order/replay -> signals -> dashboard/charts
```

The manager falls back after three consecutive failures or a five-second connection timeout. Retry delay is exponential with 0.8-1.2 jitter, capped at 30 seconds; lower-priority transports probe higher-priority transports every 30 seconds. Five-second heartbeats are sent, and the clients fail over after two missed intervals. Browser offline pauses reconnects. Connection health uses the timestamp of the last valid metric and labels displayed data stale after 10 seconds without an event.

Events are validated, deduplicated by global offset, and checked against per-service sequence numbers. An out-of-order gap is buffered for one second; if it remains, the client requests replay from its last applied offset. Replay HTTP 410 replaces state with a fresh snapshot. The client batches signal publication in a microtask, bounds pending events at 5,000, and keeps 300 recent points per service for charts. Replay history on the backend is bounded to 10,000 events. These choices bound memory and avoid duplicate application; delayed gaps add up to one second before replay starts.

Every HTTP request has a 10-second timeout. Safe GET requests retry network failures, 429, 502, 503, and 504, with at most three total attempts. `Retry-After` is honored for 429. POST retries are limited to requests carrying a UUID `Idempotency-Key`; rule creation uses that mechanism.

Chart downsampling uses evenly sized chronological buckets and averages each metric within a bucket. This bounds each series to 300 points and is cheap to explain and compute, but can smooth short spikes.

## Verification and limitations

The current production build reports an estimated initial browser transfer of about 125 kB; Chart.js is a separate lazy chunk (about 61 kB estimated transfer), and rules are also lazy loaded. These are Angular build estimates, not Chrome DevTools measurements. Browser checks confirmed 2,000 inventory entries and 14 rendered rows in the virtual viewport. Frame rate, main-thread tasks, memory growth, interaction latency, and the 2,000-events/sec target have not been measured.

The supplied workspace contained no assignment PDF. Endpoint names are taken from the request; payloads, status codes, cookie strategy, and chaos behavior must be compared with that PDF when available. Current mock event generation is fixed at 100 events/sec; chaos switches and load targets are not implemented. Incidents exist only in the browser session and are not persisted. The mock credentials and in-memory token store are for local development only, not production authentication.

GitHub Copilot was used as a coding assistant. Code and tests remain subject to developer review.
