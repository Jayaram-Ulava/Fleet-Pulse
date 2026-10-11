import { HttpErrorResponse } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { Subject, catchError, finalize, of } from 'rxjs';
import { MetricsReplayApiService } from '../http/metrics-replay-api.service';
import { FleetSnapshot, ServiceMetric, ServiceStatus } from '../models/fleet.models';
import { MetricEvent, StreamDiagnostics } from '../models/metric-event.models';

const MAX_BUFFERED_EVENTS = 5_000;
const REORDER_WINDOW_MS = 1_000;
const MAX_METRIC_POINTS_PER_SERVICE = 300;

export function parseMetricEvent(value: unknown): MetricEvent | null {
  if (!isRecord(value)) {
    return null;
  }

  const { type, offset, serviceId, seq, ts, p95, errRate, rps, status } = value;
  if (
    type !== 'metric' ||
    !Number.isSafeInteger(offset) ||
    (offset as number) < 1 ||
    typeof serviceId !== 'string' ||
    serviceId.length === 0 ||
    !Number.isSafeInteger(seq) ||
    (seq as number) < 1 ||
    typeof ts !== 'number' ||
    !Number.isFinite(ts) ||
    typeof p95 !== 'number' ||
    !Number.isFinite(p95) ||
    p95 < 0 ||
    typeof errRate !== 'number' ||
    !Number.isFinite(errRate) ||
    errRate < 0 ||
    errRate > 100 ||
    typeof rps !== 'number' ||
    !Number.isFinite(rps) ||
    rps < 0 ||
    !isServiceStatus(status)
  ) {
    return null;
  }

  return {
    type,
    offset: offset as number,
    serviceId,
    seq: seq as number,
    ts,
    p95,
    errRate,
    rps,
    status,
  };
}

@Injectable({ providedIn: 'root' })
export class MetricEventStoreService {
  private readonly replayApi = inject(MetricsReplayApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sequenceByService = new Map<string, number>();
  private readonly pendingByOffset = new Map<number, MetricEvent>();
  private readonly pendingMetricUpdates = new Map<string, ServiceMetric>();
  private readonly pendingHistoryUpdates: MetricEvent[] = [];
  private readonly metricEventSubject = new Subject<MetricEvent>();
  private replayInProgress = false;
  private publicationScheduled = false;
  private gapOpen = false;
  private gapRecoveryTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly metricsState = signal<ReadonlyMap<string, ServiceMetric>>(new Map());
  private readonly metricHistoryState = signal<ReadonlyMap<string, readonly ServiceMetric[]>>(
    new Map(),
  );
  private readonly diagnosticsState = signal<StreamDiagnostics>({
    duplicates: 0,
    gaps: 0,
    replayRequests: 0,
    malformed: 0,
  });

  readonly metrics = this.metricsState.asReadonly();
  readonly metricHistory = this.metricHistoryState.asReadonly();
  readonly events$ = this.metricEventSubject.asObservable();
  readonly diagnostics = this.diagnosticsState.asReadonly();
  readonly offset = signal(0);
  readonly lastEventAt = signal<number | null>(null);
  readonly metricCount = computed(() => this.metricsState().size);

  seed(snapshot: FleetSnapshot): void {
    const validMetrics = snapshot.services.filter(isServiceMetric);
    const metrics = new Map(validMetrics.map((metric) => [metric.serviceId, metric]));
    this.sequenceByService.clear();
    for (const metric of validMetrics) {
      this.sequenceByService.set(metric.serviceId, metric.seq);
    }

    this.pendingByOffset.clear();
    this.pendingMetricUpdates.clear();
    this.pendingHistoryUpdates.length = 0;
    this.clearGapRecoveryTimer();
    this.metricsState.set(metrics);
    this.metricHistoryState.set(
      new Map(validMetrics.map((metric) => [metric.serviceId, [metric]])),
    );
    this.offset.set(snapshot.offset);
    this.lastEventAt.set(validMetrics.length > 0 ? Date.now() : null);
    this.gapOpen = false;
  }

  accept(rawEvent: unknown): void {
    this.acceptEvent(rawEvent);
  }

  historyForService(serviceId: string): readonly ServiceMetric[] {
    return this.metricHistoryState().get(serviceId) ?? [];
  }

  private acceptEvent(rawEvent: unknown): void {
    const event = parseMetricEvent(rawEvent);
    if (!event) {
      this.incrementDiagnostic('malformed');
      console.warn('Ignored malformed metric event.');
      return;
    }

    if (event.offset <= this.offset()) {
      this.incrementDiagnostic('duplicates');
      return;
    }

    if (this.pendingByOffset.has(event.offset)) {
      this.incrementDiagnostic('duplicates');
      return;
    }

    if (this.pendingByOffset.size >= MAX_BUFFERED_EVENTS) {
      this.incrementDiagnostic('gaps');
      this.pendingByOffset.clear();
      this.recoverFromGap();
      return;
    }

    this.pendingByOffset.set(event.offset, event);
    this.drainContiguousEvents();

    if (this.pendingByOffset.size > 0 && !this.pendingByOffset.has(this.offset() + 1)) {
      if (!this.gapOpen) {
        this.incrementDiagnostic('gaps');
        this.gapOpen = true;
      }

      this.scheduleGapRecovery();
    }
  }

  private drainContiguousEvents(): void {
    while (true) {
      const nextOffset = this.offset() + 1;
      const event = this.pendingByOffset.get(nextOffset);
      if (!event) {
        break;
      }

      this.pendingByOffset.delete(nextOffset);
      const previousSequence = this.sequenceByService.get(event.serviceId) ?? 0;
      if (event.seq <= previousSequence) {
        this.incrementDiagnostic('duplicates');
        this.offset.set(event.offset);
        continue;
      }

      this.sequenceByService.set(event.serviceId, event.seq);
      this.metricEventSubject.next(event);
      this.pendingMetricUpdates.set(event.serviceId, event);
      this.pendingHistoryUpdates.push(event);
      this.offset.set(event.offset);
      this.lastEventAt.set(Date.now());
      this.scheduleMetricPublication();
    }

    if (this.pendingByOffset.size === 0) {
      this.gapOpen = false;
      this.clearGapRecoveryTimer();
    }
  }

  private scheduleGapRecovery(): void {
    if (this.gapRecoveryTimer || this.replayInProgress) {
      return;
    }

    this.gapRecoveryTimer = setTimeout(() => {
      this.gapRecoveryTimer = null;
      this.recoverFromGap();
    }, REORDER_WINDOW_MS);
  }

  private recoverFromGap(): void {
    if (this.replayInProgress) {
      return;
    }

    this.replayInProgress = true;
    this.incrementDiagnostic('replayRequests');
    this.replayApi
      .replay(this.offset())
      .pipe(
        catchError((error: unknown) => {
          if (error instanceof HttpErrorResponse && error.status === 410) {
            return this.replayApi.snapshot().pipe(
              catchError((snapshotError: unknown) => {
                console.error('Metric snapshot recovery failed.', snapshotError);
                return of(null);
              }),
            );
          }

          console.error('Metric replay request failed.', error);
          return of(null);
        }),
        finalize(() => {
          this.replayInProgress = false;
          if (this.gapOpen && this.pendingByOffset.size > 0) {
            this.scheduleGapRecovery();
          }
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((response) => {
        if (response && 'events' in response && Array.isArray(response.events)) {
          for (const event of response.events) {
            this.acceptEvent(event);
          }
          return;
        }

        if (response && 'services' in response && Array.isArray(response.services)) {
          this.seed(response as FleetSnapshot);
        }
      });
  }

  private scheduleMetricPublication(): void {
    if (this.publicationScheduled) {
      return;
    }

    this.publicationScheduled = true;
    queueMicrotask(() => {
      this.publicationScheduled = false;
      if (this.pendingMetricUpdates.size === 0 && this.pendingHistoryUpdates.length === 0) {
        return;
      }

      const nextMetrics = new Map(this.metricsState());
      for (const [serviceId, metric] of this.pendingMetricUpdates) {
        nextMetrics.set(serviceId, metric);
      }
      const nextHistory = new Map(this.metricHistoryState());
      for (const metric of this.pendingHistoryUpdates) {
        const history = nextHistory.get(metric.serviceId) ?? [];
        nextHistory.set(
          metric.serviceId,
          [...history, metric].slice(-MAX_METRIC_POINTS_PER_SERVICE),
        );
      }
      this.pendingMetricUpdates.clear();
      this.pendingHistoryUpdates.length = 0;
      this.metricsState.set(nextMetrics);
      this.metricHistoryState.set(nextHistory);
    });
  }

  private incrementDiagnostic(key: keyof StreamDiagnostics): void {
    this.diagnosticsState.update((current) => ({ ...current, [key]: current[key] + 1 }));
  }

  private clearGapRecoveryTimer(): void {
    if (this.gapRecoveryTimer) {
      clearTimeout(this.gapRecoveryTimer);
      this.gapRecoveryTimer = null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isServiceStatus(value: unknown): value is ServiceStatus {
  return value === 'healthy' || value === 'degraded' || value === 'down';
}

function isServiceMetric(value: ServiceMetric): boolean {
  return (
    typeof value.serviceId === 'string' &&
    Number.isSafeInteger(value.seq) &&
    Number.isFinite(value.ts) &&
    Number.isFinite(value.p95) &&
    value.p95 >= 0 &&
    Number.isFinite(value.errRate) &&
    value.errRate >= 0 &&
    value.errRate <= 100 &&
    Number.isFinite(value.rps) &&
    value.rps >= 0 &&
    isServiceStatus(value.status)
  );
}
