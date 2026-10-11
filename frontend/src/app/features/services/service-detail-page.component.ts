import { CommonModule } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  catchError,
  distinctUntilChanged,
  forkJoin,
  map,
  Observable,
  of,
  switchMap,
  tap,
} from 'rxjs';
import { MetricEventStoreService } from '../../core/connection/metric-event-store.service';
import { MetricTransportManagerService } from '../../core/connection/metric-transport-manager.service';
import { FleetApiService } from '../../core/http/fleet-api.service';
import { MetricsReplayApiService } from '../../core/http/metrics-replay-api.service';
import { FleetService, FleetSnapshot } from '../../core/models/fleet.models';
import { MetricHistoryPoint, ServiceMetricHistory } from '../../core/models/metric-event.models';
import { MetricChartComponent } from './metric-chart.component';
import { downsampleMetricPoints } from './metric-series.util';

interface LoadedServiceDetails {
  readonly service: FleetService;
  readonly history: ServiceMetricHistory;
  readonly snapshot: FleetSnapshot;
}

@Component({
  selector: 'app-service-detail-page',
  imports: [CommonModule, MatIconModule, MetricChartComponent, RouterLink],
  templateUrl: './service-detail-page.component.html',
  styleUrl: './service-detail-page.component.scss',
})
export class ServiceDetailPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fleetApi = inject(FleetApiService);
  private readonly historyApi = inject(MetricsReplayApiService);
  private readonly eventStore = inject(MetricEventStoreService);
  private readonly transportManager = inject(MetricTransportManagerService);

  readonly serviceId = signal('');
  readonly service = signal<FleetService | null>(null);
  readonly historicalPoints = signal<readonly MetricHistoryPoint[]>([]);
  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly chartPoints = computed(() => {
    const pointsByTimestamp = new Map<number, MetricHistoryPoint>();
    for (const point of this.historicalPoints()) {
      pointsByTimestamp.set(point.ts, point);
    }
    for (const metric of this.eventStore.historyForService(this.serviceId())) {
      pointsByTimestamp.set(metric.ts, {
        ts: metric.ts,
        p95: metric.p95,
        errRate: metric.errRate,
        rps: metric.rps,
      });
    }

    return downsampleMetricPoints([...pointsByTimestamp.values()]);
  });

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => params.get('id') ?? ''),
        distinctUntilChanged(),
        tap((serviceId) => this.resetForService(serviceId)),
        switchMap((serviceId) => this.loadService(serviceId)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((details) => this.applyDetails(details));
  }

  retryHistory(): void {
    const serviceId = this.serviceId();
    if (!serviceId) {
      return;
    }

    this.resetForService(serviceId);
    this.loadService(serviceId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((details) => this.applyDetails(details));
  }

  private resetForService(serviceId: string): void {
    this.serviceId.set(serviceId);
    this.service.set(null);
    this.historicalPoints.set([]);
    this.loadError.set(null);
    this.isLoading.set(true);
  }

  private loadService(serviceId: string): Observable<LoadedServiceDetails | null> {
    if (!serviceId) {
      return of(null);
    }

    return forkJoin({
      services: this.fleetApi.getServices(),
      history: this.historyApi.historyForService(serviceId, 15),
      snapshot: this.fleetApi.getSnapshot(),
    }).pipe(
      map(({ services, history, snapshot }) => {
        const service = services.services.find((candidate) => candidate.serviceId === serviceId);
        return service ? { service, history, snapshot } : null;
      }),
      catchError(() => of(null)),
    );
  }

  private applyDetails(details: LoadedServiceDetails | null): void {
    this.isLoading.set(false);
    if (!details) {
      this.loadError.set('Service details could not be loaded. Check the service ID and retry.');
      return;
    }

    this.service.set(details.service);
    this.historicalPoints.set(details.history.points);
    if (this.transportManager.status() === 'stopped') {
      this.eventStore.seed(details.snapshot);
    }
    this.transportManager.start();
  }
}
