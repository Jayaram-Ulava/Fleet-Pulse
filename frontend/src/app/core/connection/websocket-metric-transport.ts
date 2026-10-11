import { AuthService } from '../auth/auth.service';
import { environment } from '../../../environments/environment';
import { MetricTransport, MetricTransportObserver } from './metric-transport';

export class WebSocketMetricTransport implements MetricTransport {
  readonly kind = 'websocket' as const;
  private socket: WebSocket | null = null;
  private observer: MetricTransportObserver | null = null;
  private closedByClient = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;

  constructor(private readonly auth: AuthService) {}

  connect(observer: MetricTransportObserver): void {
    const accessToken = this.auth.accessToken();
    if (!accessToken) {
      observer.failed(new Error('An access token is required for the metric stream.'));
      return;
    }

    this.observer = observer;
    this.closedByClient = false;
    this.missedHeartbeats = 0;
    const url = new URL(environment.streamBaseUrl, globalThis.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    this.socket = new WebSocket(url, ['fleet-pulse-v1', `bearer.${accessToken}`]);
    this.socket.onopen = () => observer.connected();
    this.socket.onmessage = (message) => {
      this.missedHeartbeats = 0;
      try {
        const value = JSON.parse(String(message.data)) as unknown;
        if (isHeartbeat(value)) {
          return;
        }
        observer.event(value);
      } catch {
        observer.event(message.data);
      }
    };
    this.heartbeatTimer = setInterval(() => {
      this.missedHeartbeats += 1;
      if (this.missedHeartbeats >= 2) {
        observer.failed(new Error('Two WebSocket heartbeats were missed.'));
      }
    }, 5_000);
    this.socket.onerror = () => observer.failed(new Error('WebSocket connection failed.'));
    this.socket.onclose = () => {
      if (!this.closedByClient) {
        observer.failed(new Error('WebSocket connection closed.'));
      }
    };
  }

  close(): void {
    this.closedByClient = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.observer = null;
  }
}

function isHeartbeat(value: unknown): value is { readonly type: 'heartbeat' } {
  return (
    typeof value === 'object' && value !== null && 'type' in value && value.type === 'heartbeat'
  );
}
