import { WebSocketServer } from 'ws';
import { authenticatedUser } from './app.js';

const STREAM_HEARTBEAT_INTERVAL_MS = 5_000;

export function attachMetricWebSocketServer(server, app) {
  const webSocketServer = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has('fleet-pulse-v1') ? 'fleet-pulse-v1' : false),
  });
  const metricStream = app.locals.metricStream;
  const authService = app.locals.authService;

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host}`);
    if (requestUrl.pathname !== '/stream') {
      socket.destroy();
      return;
    }

    const protocols = request.headers['sec-websocket-protocol']
      ?.split(',')
      .map((value) => value.trim());
    const bearerProtocol = protocols?.find((value) => value.startsWith('bearer.'));
    const accessToken = bearerProtocol?.slice('bearer.'.length);
    const user = accessToken
      ? authService.authenticate(accessToken)
      : authenticatedUser(request, authService);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  webSocketServer.on('connection', (webSocket) => {
    let isAlive = true;
    let missedHeartbeats = 0;
    webSocket.on('pong', () => {
      isAlive = true;
      missedHeartbeats = 0;
    });

    const unsubscribe = metricStream.subscribe((event) => {
      if (webSocket.readyState === webSocket.OPEN) {
        webSocket.send(JSON.stringify(event));
      }
    });
    const heartbeat = setInterval(() => {
      if (webSocket.readyState !== webSocket.OPEN) {
        return;
      }

      if (!isAlive) {
        missedHeartbeats += 1;
        if (missedHeartbeats >= 2) {
          webSocket.terminate();
          return;
        }
      }

      isAlive = false;
      webSocket.ping();
      webSocket.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
    }, STREAM_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();
    webSocket.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return webSocketServer;
}
