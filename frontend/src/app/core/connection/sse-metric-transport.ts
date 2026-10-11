import { AuthService } from '../auth/auth.service';
import { environment } from '../../../environments/environment';
import { MetricTransport, MetricTransportObserver } from './metric-transport';

export class SseMetricTransport implements MetricTransport {
  readonly kind = 'sse' as const;
  private controller: AbortController | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;

  constructor(private readonly auth: AuthService) {}

  connect(observer: MetricTransportObserver): void {
    const accessToken = this.auth.accessToken();
    if (!accessToken) {
      observer.failed(new Error('An access token is required for the metric stream.'));
      return;
    }

    this.controller = new AbortController();
    this.missedHeartbeats = 0;
    this.heartbeatTimer = setInterval(() => {
      this.missedHeartbeats += 1;
      if (this.missedHeartbeats >= 2) {
        observer.failed(new Error('Two SSE heartbeats were missed.'));
      }
    }, 5_000);
    void this.readEvents(accessToken, observer, this.controller.signal);
  }

  close(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async readEvents(
    accessToken: string,
    observer: MetricTransportObserver,
    abortSignal: AbortSignal,
  ): Promise<void> {
    try {
      const response = await fetch(`${environment.apiBaseUrl}/stream/sse`, {
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${accessToken}`,
        },
        credentials: 'include',
        signal: abortSignal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE connection returned HTTP ${response.status}.`);
      }

      observer.connected();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bufferedText = '';

      while (!abortSignal.aborted) {
        const { value, done } = await reader.read();
        if (done) {
          throw new Error('SSE connection closed.');
        }

        this.missedHeartbeats = 0;
        bufferedText += decoder.decode(value, { stream: true });
        const messages = bufferedText.split(/\r?\n\r?\n/);
        bufferedText = messages.pop() ?? '';
        for (const message of messages) {
          const data = message
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data) {
            continue;
          }

          try {
            observer.event(JSON.parse(data) as unknown);
          } catch {
            observer.event(data);
          }
        }
      }
    } catch (error: unknown) {
      if (!abortSignal.aborted) {
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
        observer.failed(error);
      }
    }
  }
}
