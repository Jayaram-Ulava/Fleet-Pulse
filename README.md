# FleetPulse

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.26.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

# Fleet Pulse

Fleet Pulse is an operations dashboard assignment implemented as an Angular 21.2 and Express npm-workspace repository. The implementation is being delivered in verified phases; this foundation currently provides the Angular shell, development tooling, and a health-only mock API. Fleet data, authentication, streams, rules, and incidents are not implemented yet.

## Requirements

- Node.js 22.12 or newer and npm 10.9.2 or newer
- Docker with the Compose plugin (optional)

Angular 21.2, TypeScript strict mode, Angular Material, Sass, RxJS, Vitest, ESLint/angular-eslint, Express 5, and `ws` are configured in the workspaces.

## Run locally

```bash
npm ci
npm run start --workspace @fleet-pulse/backend
```

In a second terminal:

```bash
npm start
```

Open `http://localhost:4200`. The Angular dev-server proxies `/api/*` to the backend on port 3000 and proxies `/stream` with WebSocket support. The only backend endpoint available in this phase is `GET /health` at `http://localhost:3000/health`.

## Commands

```bash
npm run build
npm test
npm run lint
npm run format:check
```

To run Angular's lint target directly, run `npx ng lint` from `frontend/`. The backend uses Node's built-in test runner. `npm test` runs the test command in each workspace.

## Docker Compose

```bash
docker compose up --build
```

The frontend is available at `http://localhost:4200`; the backend health endpoint is at `http://localhost:3000/health`. Compose waits for the backend health check before starting the frontend container.

## Architecture

- `frontend/` contains the standalone Angular app. Route-level pages are lazy loaded under `src/app/features`; shared authentication, HTTP, stream, connection, model, and utility code will live under `src/app/core` and `src/app/shared` as those phases are implemented.
- `backend/` contains the Express mock API. API behavior will be added behind explicit modules and covered with Node tests.
- Root npm workspaces share one lockfile so `npm ci` installs a reproducible dependency graph.
- `frontend/src/environments/environment.ts` centralizes API and stream base paths. The local proxy and Compose nginx config route browser traffic to the backend without embedding container hostnames in Angular.

The planned stream pipeline is:

```text
WebSocket -> SSE -> polling
	|         |        |
	+---- transport manager ----> event validation/order/replay ----> signals and feature state
```

The detailed fallback, replay, retry, and refresh policies will be documented alongside their implementation and tests.

## Performance and scope notes

The initial Angular production build for the shell reported an estimated 95.18 kB transferred for initial browser chunks. This is build output, not a Chrome DevTools measurement; frame rate, long tasks, memory growth, interaction latency, and the 2,000-event/sec target have not been measured. Record Chrome Performance and Memory panel results with browser/version, fixture size, event rate, and capture duration before claiming those targets.

The assignment PDF was not present in the supplied workspace when this phase began. The endpoint names in the request are known, but exact PDF-specific payloads and chaos behavior must be checked against the source document before claiming contract parity. No test accounts, chaos switches, or non-health API responses are active yet.

## AI tools

GitHub Copilot was used as a coding assistant. Implementation and verification results are recorded per phase; generated code and tests remain subject to developer review.
