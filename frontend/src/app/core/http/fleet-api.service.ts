import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { FleetService, FleetSnapshot } from '../models/fleet.models';

@Injectable({ providedIn: 'root' })
export class FleetApiService {
  private readonly http = inject(HttpClient);

  getServices(): Observable<{ readonly services: readonly FleetService[] }> {
    return this.http.get<{ readonly services: readonly FleetService[] }>(
      `${environment.apiBaseUrl}/services`,
    );
  }

  getSnapshot(): Observable<FleetSnapshot> {
    return this.http.get<FleetSnapshot>(`${environment.apiBaseUrl}/metrics/snapshot`);
  }
}
