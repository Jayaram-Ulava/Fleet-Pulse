import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { FleetSnapshot } from '../models/fleet.models';
import { ReplayResponse, ServiceMetricHistory } from '../models/metric-event.models';

@Injectable({ providedIn: 'root' })
export class MetricsReplayApiService {
  private readonly http = inject(HttpClient);

  replay(sinceOffset: number): Observable<ReplayResponse> {
    return this.http.get<ReplayResponse>(
      `${environment.apiBaseUrl}/metrics/replay?since=${sinceOffset}`,
    );
  }

  snapshot(): Observable<FleetSnapshot> {
    return this.http.get<FleetSnapshot>(`${environment.apiBaseUrl}/metrics/snapshot`);
  }

  historyForService(serviceId: string, minutes: number): Observable<ServiceMetricHistory> {
    const query = new URLSearchParams({ serviceId, minutes: String(minutes) });
    return this.http.get<ServiceMetricHistory>(
      `${environment.apiBaseUrl}/metrics/history?${query.toString()}`,
    );
  }
}
