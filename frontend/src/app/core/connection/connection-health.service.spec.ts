import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ConnectionHealthService } from './connection-health.service';
import { MetricEventStoreService } from './metric-event-store.service';
import { MetricTransportFactory } from './metric-transport.factory';
import { MetricTransportManagerService } from './metric-transport-manager.service';

describe('ConnectionHealthService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MetricTransportFactory,
          useValue: { create: () => ({ close() {}, connect() {} }) },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(MetricTransportManagerService).stop();
    vi.useRealTimers();
  });

  it('marks snapshot data stale after ten seconds and never labels it live', async () => {
    const store = TestBed.inject(MetricEventStoreService);
    const health = TestBed.inject(ConnectionHealthService);
    store.seed({
      offset: 0,
      services: [
        {
          serviceId: 'svc-0001',
          seq: 1,
          ts: Date.now(),
          p95: 100,
          errRate: 0.1,
          rps: 50,
          status: 'healthy',
        },
      ],
    });

    await vi.advanceTimersByTimeAsync(11_000);

    expect(health.isStale()).toBe(true);
    expect(health.status()).toBe('stale');
    expect(health.label()).toContain('Stale data · 11s');
    expect(health.label()).not.toContain('Live');
  });
});
