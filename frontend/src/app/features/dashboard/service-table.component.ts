import { ScrollingModule } from '@angular/cdk/scrolling';
import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FleetServiceRow, ServiceStatus } from '../../core/models/fleet.models';
import { StreamDiagnostics } from '../../core/models/metric-event.models';

export type FleetStatusFilter = 'all' | ServiceStatus;
export type FleetSortField = 'serviceId' | 'name' | 'team' | 'status' | 'p95' | 'errRate' | 'rps';
export type FleetSortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-service-table',
  imports: [CommonModule, MatIconModule, ReactiveFormsModule, RouterLink, ScrollingModule],
  templateUrl: './service-table.component.html',
  styleUrl: './service-table.component.scss',
})
export class ServiceTableComponent {
  readonly rows = input.required<readonly FleetServiceRow[]>();
  readonly searchControl = input.required<FormControl<string>>();
  readonly statusFilter = input.required<FleetStatusFilter>();
  readonly sortField = input.required<FleetSortField>();
  readonly sortDirection = input.required<FleetSortDirection>();
  readonly isLoading = input.required<boolean>();
  readonly hasServices = input.required<boolean>();
  readonly loadError = input<string | null>(null);
  readonly diagnostics = input.required<StreamDiagnostics>();
  readonly compactRows = input(false);
  readonly isDataStale = input(false);

  readonly statusFilterChange = output<FleetStatusFilter>();
  readonly sortChange = output<FleetSortField>();
  readonly retry = output<void>();

  setStatusFilterFromEvent(event: Event): void {
    if (event.target instanceof HTMLSelectElement) {
      const status = event.target.value as FleetStatusFilter;
      if (['all', 'healthy', 'degraded', 'down'].includes(status)) {
        this.statusFilterChange.emit(status);
      }
    }
  }

  trackService(_index: number, service: FleetServiceRow): string {
    return service.serviceId;
  }

  sortLabel(field: FleetSortField): string {
    if (this.sortField() !== field) {
      return 'Sort';
    }

    return this.sortDirection() === 'asc' ? 'Sorted ascending' : 'Sorted descending';
  }
}
