import { createApp } from './app.js';
import { attachMetricWebSocketServer } from './websocket-server.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const app = createApp();
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Fleet Pulse mock API listening on port ${port}`);
});
const metricStream = app.locals.metricStream;
const webSocketServer = attachMetricWebSocketServer(server, app);

metricStream.start();

process.on('SIGINT', () => {
  metricStream.stop();
  webSocketServer.close();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  metricStream.stop();
  webSocketServer.close();
  server.close(() => process.exit(0));
});
