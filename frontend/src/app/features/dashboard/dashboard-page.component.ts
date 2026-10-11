import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime, distinctUntilChanged, finalize, forkJoin } from 'rxjs';
import { FleetApiService } from '../../core/http/fleet-api.service';
import { MetricEventStoreService } from '../../core/connection/metric-event-store.service';
import { MetricTransportManagerService } from '../../core/connection/metric-transport-manager.service';
import { DashboardSettingsService } from '../../core/settings/dashboard-settings.service';
import { ConnectionHealthService } from '../../core/connection/connection-health.service';
import { FleetService, FleetServiceRow } from '../../core/models/fleet.models';
import {
  FleetSortDirection,
  FleetSortField,
  FleetStatusFilter,
  ServiceTableComponent,
} from './service-table.component';

const SORT_FIELDS: readonly FleetSortField[] = [
  'serviceId',
  'name',
  'team',
  'status',
  'p95',
  'errRate',
  'rps',
];
const STATUS_FILTERS: readonly FleetStatusFilter[] = ['all', 'healthy', 'degraded', 'down'];

@Component({
  selector: 'app-dashboard-page',
  imports: [CommonModule, MatIconModule, ServiceTableComponent],
  templateUrl: './dashboard-page.component.html',
  styleUrl: './dashboard-page.component.scss',
})
export class DashboardPageComponent implements OnInit {
  private readonly fleetApi = inject(FleetApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly eventStore = inject(MetricEventStoreService);
  private readonly transportManager = inject(MetricTransportManagerService);
  private readonly settingsService = inject(DashboardSettingsService);
  private readonly connectionHealth = inject(ConnectionHealthService);

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly services = signal<readonly FleetService[]>([]);
  readonly metrics = this.eventStore.metrics;
  readonly diagnostics = this.eventStore.diagnostics;
  readonly settings = this.settingsService.settings;
  readonly isDataStale = this.connectionHealth.isStale;
  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly searchTerm = signal('');
  readonly statusFilter = signal<FleetStatusFilter>('all');
  readonly sortField = signal<FleetSortField>('serviceId');
  readonly sortDirection = signal<FleetSortDirection>('asc');

  readonly rows = computed(() => {
    const metrics = this.metrics();
    const searchTerm = this.searchTerm().toLocaleLowerCase();
    const statusFilter = this.statusFilter();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;

    return this.services()
      .flatMap((service): FleetServiceRow[] => {
        const metric = metrics.get(service.serviceId);
        return metric ? [{ ...service, ...metric }] : [];
      })
      .filter((service) => {
        const matchesStatus = statusFilter === 'all' || service.status === statusFilter;
        const searchableText =
          `${service.serviceId} ${service.name} ${service.team}`.toLocaleLowerCase();
        return matchesStatus && searchableText.includes(searchTerm);
      })
      .sort(
        (left, right) => compareValues(left[this.sortField()], right[this.sortField()]) * direction,
      );
  });

  readonly healthyCount = computed(
    () => [...this.metrics().values()].filter((metric) => metric.status === 'healthy').length,
  );
  readonly degradedCount = computed(
    () => [...this.metrics().values()].filter((metric) => metric.status === 'degraded').length,
  );
  readonly downCount = computed(
    () => [...this.metrics().values()].filter((metric) => metric.status === 'down').length,
  );

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const query = params.get('q') ?? '';
      const status = params.get('status') as FleetStatusFilter | null;
      const sort = params.get('sort') as FleetSortField | null;
      const direction = params.get('dir');

      this.searchTerm.set(query.trim());
      if (this.searchControl.value !== query) {
        this.searchControl.setValue(query, { emitEvent: false });
      }
      this.statusFilter.set(status && STATUS_FILTERS.includes(status) ? status : 'all');
      this.sortField.set(sort && SORT_FIELDS.includes(sort) ? sort : 'serviceId');
      this.sortDirection.set(direction === 'desc' ? 'desc' : 'asc');
    });

    this.searchControl.valueChanges
      .pipe(debounceTime(160), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((query) => {
        this.searchTerm.set(query.trim());
        this.updateQueryParams();
      });

    this.loadFleet();
  }

  loadFleet(): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    forkJoin({ services: this.fleetApi.getServices(), snapshot: this.fleetApi.getSnapshot() })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe({
        next: ({ services, snapshot }) => {
          this.services.set(services.services);
          this.eventStore.seed(snapshot);
          this.transportManager.start();
        },
        error: (error: unknown) => {
          this.loadError.set(
            error instanceof HttpErrorResponse && error.status === 0
              ? 'Fleet API is offline. Check the backend connection and retry.'
              : 'Fleet data could not be loaded. Please retry.',
          );
        },
      });
  }

  setStatusFilter(value: FleetStatusFilter): void {
    if (STATUS_FILTERS.includes(value)) {
      this.statusFilter.set(value);
      this.updateQueryParams();
    }
  }

  sortBy(field: FleetSortField): void {
    const direction = this.sortField() === field && this.sortDirection() === 'asc' ? 'desc' : 'asc';
    this.sortField.set(field);
    this.sortDirection.set(direction);
    this.updateQueryParams();
  }

  private updateQueryParams(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: this.searchTerm() || null,
        status: this.statusFilter() === 'all' ? null : this.statusFilter(),
        sort: this.sortField() === 'serviceId' ? null : this.sortField(),
        dir: this.sortDirection() === 'asc' ? null : this.sortDirection(),
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

function compareValues(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  return String(left).localeCompare(String(right));
}
