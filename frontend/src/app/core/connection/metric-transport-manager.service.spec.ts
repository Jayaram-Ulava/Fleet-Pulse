import { TestBed } from '@angular/core/testing';
import { MetricEventStoreService } from './metric-event-store.service';
import { MetricTransportFactory } from './metric-transport.factory';
import { MetricTransport, MetricTransportKind, MetricTransportObserver } from './metric-transport';
import {
  calculateRetryDelay,
  MetricTransportManagerService,
} from './metric-transport-manager.service';

class FakeMetricTransport implements MetricTransport {
  observer: MetricTransportObserver | null = null;
  closeCount = 0;

  constructor(readonly kind: MetricTransportKind) {}

  connect(observer: MetricTransportObserver): void {
    this.observer = observer;
  }

  close(): void {
    this.closeCount += 1;
  }

  succeed(): void {
    this.observer?.connected();
  }

  fail(): void {
    this.observer?.failed(new Error(`${this.kind} failed`));
  }
}

class FakeMetricTransportFactory {
  readonly created: FakeMetricTransport[] = [];

  create(kind: MetricTransportKind): FakeMetricTransport {
    const transport = new FakeMetricTransport(kind);
    this.created.push(transport);
    return transport;
  }
}

describe('MetricTransportManagerService', () => {
  let manager: MetricTransportManagerService;
  let factory: FakeMetricTransportFactory;

  beforeEach(() => {
    vi.useFakeTimers();
    factory = new FakeMetricTransportFactory();
    TestBed.configureTestingModule({
      providers: [
        MetricEventStoreService,
        MetricTransportManagerService,
        { provide: MetricTransportFactory, useValue: factory },
      ],
    });
    manager = TestBed.inject(MetricTransportManagerService);
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  it('falls back from WebSocket to SSE after three failures', async () => {
    manager.start();
    expect(factory.created[0].kind).toBe('websocket');

    factory.created[0].fail();
    await vi.advanceTimersByTimeAsync(manager.retryDelayMs() ?? 0);
    factory.created[1].fail();
    await vi.advanceTimersByTimeAsync(manager.retryDelayMs() ?? 0);
    factory.created[2].fail();

    expect(factory.created[3].kind).toBe('sse');
    factory.created[3].succeed();
    expect(manager.status()).toBe('live-sse');
  });

  it('falls back immediately when a connection exceeds five seconds', async () => {
    manager.start();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(factory.created.map((transport) => transport.kind)).toEqual(['websocket', 'sse']);
  });

  it('caps exponential retries at 30 seconds and applies bounded jitter', () => {
    expect(calculateRetryDelay(1, () => 0)).toBe(800);
    expect(calculateRetryDelay(2, () => 0.5)).toBe(2_000);
    expect(calculateRetryDelay(10, () => 1)).toBe(30_000);
  });

  it('stops retries while offline and resumes with WebSocket when online', () => {
    manager.start();
    window.dispatchEvent(new Event('offline'));
    expect(manager.status()).toBe('offline');

    window.dispatchEvent(new Event('online'));
    expect(factory.created.map((transport) => transport.kind)).toEqual(['websocket', 'websocket']);
  });

  it('recovers from SSE to WebSocket on the 30-second higher-priority probe', async () => {
    manager.start();
    factory.created[0].fail();
    await vi.advanceTimersByTimeAsync(manager.retryDelayMs() ?? 0);
    factory.created[1].fail();
    await vi.advanceTimersByTimeAsync(manager.retryDelayMs() ?? 0);
    factory.created[2].fail();
    factory.created[3].succeed();
    expect(manager.status()).toBe('live-sse');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(factory.created[4].kind).toBe('websocket');
    factory.created[4].succeed();

    expect(manager.status()).toBe('live-websocket');
    expect(factory.created[3].closeCount).toBeGreaterThan(0);
  });
});
