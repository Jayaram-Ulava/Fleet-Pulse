import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MetricEventStoreService } from './metric-event-store.service';

function metricEvent(offset: number, seq: number, ts = offset * 1_000) {
  return {
    type: 'metric',
    offset,
    serviceId: 'svc-0001',
    seq,
    ts,
    p95: 100 + seq,
    errRate: 0.2,
    rps: 40 + seq,
    status: 'healthy',
  };
}

describe('MetricEventStoreService', () => {
  let store: MetricEventStoreService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(MetricEventStoreService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('ignores duplicate offsets and duplicate per-service sequences', async () => {
    store.seed({
      offset: 0,
      services: [
        {
          serviceId: 'svc-0001',
          seq: 1,
          ts: 1_000,
          p95: 90,
          errRate: 0.1,
          rps: 30,
          status: 'healthy',
        },
      ],
    });
    const event = metricEvent(1, 2);

    store.accept(event);
    store.accept(event);
    store.accept({ ...metricEvent(2, 2), offset: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.offset()).toBe(2);
    expect(store.diagnostics().duplicates).toBe(2);
    expect(store.metrics().get('svc-0001')?.seq).toBe(2);
  });

  it('applies an out-of-order event within one second without requesting replay', async () => {
    vi.useFakeTimers();
    store.accept(metricEvent(2, 2, 2_000));
    httpTesting.expectNone('/api/metrics/replay?since=0');
    store.accept(metricEvent(1, 1, 1_000));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(store.offset()).toBe(2);
    expect(store.diagnostics()).toEqual({
      duplicates: 0,
      gaps: 1,
      replayRequests: 0,
      malformed: 0,
    });
    expect(store.metrics().get('svc-0001')?.seq).toBe(2);
    vi.useRealTimers();
  });

  it('requests replay after the one-second out-of-order window expires', async () => {
    vi.useFakeTimers();
    store.accept(metricEvent(2, 2, 2_000));
    await vi.advanceTimersByTimeAsync(1_000);
    const replay = httpTesting.expectOne('/api/metrics/replay?since=0');
    replay.flush({ events: [metricEvent(1, 1, 1_000), metricEvent(2, 2, 2_000)] });
    await vi.advanceTimersByTimeAsync(0);

    expect(store.offset()).toBe(2);
    expect(store.diagnostics().replayRequests).toBe(1);
    expect(store.metrics().get('svc-0001')?.seq).toBe(2);
    vi.useRealTimers();
  });

  it('counts malformed metric events without throwing', () => {
    expect(() => store.accept({ ...metricEvent(1, 1), errRate: 140 })).not.toThrow();
    expect(store.diagnostics().malformed).toBe(1);
    expect(store.offset()).toBe(0);
  });

  it('keeps the latest 300 points per service during a burst', async () => {
    for (let offset = 1; offset <= 301; offset += 1) {
      store.accept(metricEvent(offset, offset));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    const history = store.historyForService('svc-0001');
    expect(history).toHaveLength(300);
    expect(history[0]?.seq).toBe(2);
    expect(history[299]?.seq).toBe(301);
  });

  it('reloads a full snapshot when replay history has expired', async () => {
    vi.useFakeTimers();
    store.accept(metricEvent(2, 2));
    await vi.advanceTimersByTimeAsync(1_000);
    httpTesting
      .expectOne('/api/metrics/replay?since=0')
      .flush({ error: { code: 'HISTORY_EXPIRED' } }, { status: 410, statusText: 'Gone' });
    httpTesting.expectOne('/api/metrics/snapshot').flush({
      offset: 2,
      services: [
        {
          serviceId: 'svc-0001',
          seq: 2,
          ts: 2_000,
          p95: 102,
          errRate: 0.2,
          rps: 42,
          status: 'healthy',
        },
      ],
    });

    expect(store.offset()).toBe(2);
    expect(store.metrics().get('svc-0001')?.seq).toBe(2);
    expect(store.diagnostics().replayRequests).toBe(1);
    vi.useRealTimers();
  });
});
