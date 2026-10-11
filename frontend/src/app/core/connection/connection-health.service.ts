import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, computed, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { MetricEventStoreService } from './metric-event-store.service';
import {
  MetricConnectionStatus,
  MetricTransportManagerService,
} from './metric-transport-manager.service';

const STALE_AFTER_MS = 10_000;
const HEALTH_CLOCK_INTERVAL_MS = 1_000;

@Injectable({ providedIn: 'root' })
export class ConnectionHealthService {
  private readonly eventStore = inject(MetricEventStoreService);
  private readonly transportManager = inject(MetricTransportManagerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly now = signal(Date.now());

  readonly transportStatus = this.transportManager.status;
  readonly retryDelayMs = this.transportManager.retryDelayMs;
  readonly dataAgeSeconds = computed(() => {
    const lastEventAt = this.eventStore.lastEventAt();
    return lastEventAt === null
      ? null
      : Math.max(0, Math.floor((this.now() - lastEventAt) / 1_000));
  });
  readonly isStale = computed(() => {
    const lastEventAt = this.eventStore.lastEventAt();
    return lastEventAt !== null && this.now() - lastEventAt > STALE_AFTER_MS;
  });
  readonly status = computed<MetricConnectionStatus | 'stale'>(() =>
    this.isStale() ? 'stale' : this.transportStatus(),
  );
  readonly label = computed(() => {
    if (this.isStale()) {
      const age = this.dataAgeSeconds() ?? 0;
      const offlinePrefix = this.transportStatus() === 'offline' ? 'Offline · ' : '';
      return `${offlinePrefix}Stale data · ${age}s`;
    }

    switch (this.transportStatus()) {
      case 'live-websocket':
        return 'Live (WebSocket)';
      case 'live-sse':
        return 'Live (SSE)';
      case 'polling':
        return 'Polling';
      case 'connecting':
        return 'Connecting';
      case 'reconnecting':
        return 'Reconnecting';
      case 'offline':
        return 'Offline';
      case 'stopped':
        return 'Not connected';
    }
  });

  constructor() {
    if (!this.isBrowser) {
      return;
    }

    const clock = setInterval(() => this.now.set(Date.now()), HEALTH_CLOCK_INTERVAL_MS);
    this.destroyRef.onDestroy(() => clearInterval(clock));
  }
}
