import { Subscription } from 'rxjs';
import { FleetApiService } from '../http/fleet-api.service';
import { DashboardSettingsService } from '../settings/dashboard-settings.service';
import { MetricTransport, MetricTransportObserver } from './metric-transport';

export class PollingMetricTransport implements MetricTransport {
  readonly kind = 'polling' as const;
  private subscription: Subscription | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private requestInProgress = false;
  private hasConnected = false;

  constructor(
    private readonly fleetApi: FleetApiService,
    private readonly settings: DashboardSettingsService,
  ) {}

  connect(observer: MetricTransportObserver): void {
    this.close();
    this.hasConnected = false;
    const poll = () => {
      if (this.requestInProgress) {
        return;
      }

      this.requestInProgress = true;
      this.subscription = this.fleetApi.getSnapshot().subscribe({
        next: (snapshot) => {
          this.requestInProgress = false;
          if (!this.hasConnected) {
            this.hasConnected = true;
            observer.connected();
          }
          observer.snapshot(snapshot);
        },
        error: (error: unknown) => {
          this.requestInProgress = false;
          observer.failed(error);
        },
      });
    };

    poll();
    const pollingIntervalMs = this.settings.settings().refreshIntervalSeconds * 1_000;
    this.timer = setInterval(poll, pollingIntervalMs);
  }

  close(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.requestInProgress = false;
  }
}
