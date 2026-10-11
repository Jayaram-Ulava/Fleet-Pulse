import { inject, Injectable } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { FleetApiService } from '../http/fleet-api.service';
import { DashboardSettingsService } from '../settings/dashboard-settings.service';
import { MetricTransport, MetricTransportKind } from './metric-transport';
import { PollingMetricTransport } from './polling-metric-transport';
import { SseMetricTransport } from './sse-metric-transport';
import { WebSocketMetricTransport } from './websocket-metric-transport';

@Injectable({ providedIn: 'root' })
export class MetricTransportFactory {
  private readonly auth = inject(AuthService);
  private readonly fleetApi = inject(FleetApiService);
  private readonly settings = inject(DashboardSettingsService);

  create(kind: MetricTransportKind): MetricTransport {
    switch (kind) {
      case 'websocket':
        return new WebSocketMetricTransport(this.auth);
      case 'sse':
        return new SseMetricTransport(this.auth);
      case 'polling':
        return new PollingMetricTransport(this.fleetApi, this.settings);
    }
  }
}
