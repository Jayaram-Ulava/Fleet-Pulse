import { inject, Injectable, signal } from '@angular/core';
import { MetricEventStoreService } from './metric-event-store.service';
import { MetricTransportFactory } from './metric-transport.factory';
import { MetricTransport, MetricTransportKind, MetricTransportObserver } from './metric-transport';

const TRANSPORT_ORDER: readonly MetricTransportKind[] = ['websocket', 'sse', 'polling'];
const CONNECTION_TIMEOUT_MS = 5_000;
const HIGHER_PRIORITY_RETRY_MS = 30_000;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_FAILURES_BEFORE_FALLBACK = 3;

export type MetricConnectionStatus =
  'connecting' | 'live-websocket' | 'live-sse' | 'polling' | 'reconnecting' | 'offline' | 'stopped';

export function calculateRetryDelay(attempt: number, random = Math.random): number {
  const exponentialDelay = Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1),
  );
  const jitterFactor = 0.8 + random() * 0.4;
  return Math.round(Math.min(MAX_RETRY_DELAY_MS, exponentialDelay * jitterFactor));
}

@Injectable({ providedIn: 'root' })
export class MetricTransportManagerService {
  private readonly factory = inject(MetricTransportFactory);
  private readonly eventStore = inject(MetricEventStoreService);

  readonly status = signal<MetricConnectionStatus>('stopped');
  readonly retryDelayMs = signal<number | null>(null);

  private activeIndex = 0;
  private activeTransport: MetricTransport | null = null;
  private failureCount = 0;
  private retryAttempt = 0;
  private generation = 0;
  private probeGeneration = 0;
  private started = false;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private upgradeTimer: ReturnType<typeof setInterval> | null = null;
  private probeTransport: MetricTransport | null = null;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    window.addEventListener('offline', this.handleOffline);
    window.addEventListener('online', this.handleOnline);
    if (!navigator.onLine) {
      this.status.set('offline');
      return;
    }

    this.connectActive(0);
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.generation += 1;
    window.removeEventListener('offline', this.handleOffline);
    window.removeEventListener('online', this.handleOnline);
    this.clearTimers();
    this.activeTransport?.close();
    this.probeTransport?.close();
    this.activeTransport = null;
    this.probeTransport = null;
    this.status.set('stopped');
    this.retryDelayMs.set(null);
  }

  restartPollingIfActive(): void {
    if (this.started && this.activeIndex === TRANSPORT_ORDER.length - 1) {
      this.connectActive(this.activeIndex);
    }
  }

  private readonly handleOffline = (): void => {
    this.clearTimers();
    this.activeTransport?.close();
    this.probeTransport?.close();
    this.activeTransport = null;
    this.probeTransport = null;
    this.status.set('offline');
    this.retryDelayMs.set(null);
  };

  private readonly handleOnline = (): void => {
    if (this.started) {
      this.failureCount = 0;
      this.retryAttempt = 0;
      this.connectActive(0);
    }
  };

  private connectActive(index: number): void {
    if (!this.started || !navigator.onLine) {
      this.status.set('offline');
      return;
    }

    this.clearConnectionTimer();
    this.activeTransport?.close();
    this.activeIndex = index;
    const transport = this.factory.create(TRANSPORT_ORDER[index]);
    const attemptGeneration = ++this.generation;
    this.activeTransport = transport;
    this.status.set(index === 0 && this.failureCount === 0 ? 'connecting' : 'reconnecting');
    this.retryDelayMs.set(null);
    this.connectionTimer = setTimeout(
      () => this.handleActiveFailure(index, attemptGeneration, true),
      CONNECTION_TIMEOUT_MS,
    );

    transport.connect(this.createObserver(transport, index, attemptGeneration, false));
  }

  private createObserver(
    transport: MetricTransport,
    index: number,
    attemptGeneration: number,
    isProbe: boolean,
  ): MetricTransportObserver {
    return {
      connected: () => {
        if (isProbe) {
          this.promoteProbe(transport, index, attemptGeneration);
          return;
        }
        if (attemptGeneration !== this.generation) {
          return;
        }

        this.clearConnectionTimer();
        this.failureCount = 0;
        this.retryAttempt = 0;
        this.status.set(statusForKind(transport.kind));
        this.retryDelayMs.set(null);
        this.scheduleHigherPriorityProbe();
      },
      event: (value) => this.eventStore.accept(value),
      snapshot: (value) => this.eventStore.seed(value),
      failed: () => {
        if (isProbe) {
          this.failProbe(transport, attemptGeneration);
        } else {
          this.handleActiveFailure(index, attemptGeneration, false);
        }
      },
    };
  }

  private handleActiveFailure(index: number, attemptGeneration: number, timedOut: boolean): void {
    if (!this.started || attemptGeneration !== this.generation) {
      return;
    }

    this.clearConnectionTimer();
    this.activeTransport?.close();
    this.failureCount += 1;

    if (
      index < TRANSPORT_ORDER.length - 1 &&
      (timedOut || this.failureCount >= MAX_FAILURES_BEFORE_FALLBACK)
    ) {
      this.failureCount = 0;
      this.retryAttempt = 0;
      this.connectActive(index + 1);
      return;
    }

    this.scheduleReconnect(index);
  }

  private scheduleReconnect(index: number): void {
    if (!navigator.onLine || this.retryTimer) {
      return;
    }

    const delay = calculateRetryDelay(++this.retryAttempt);
    this.status.set('reconnecting');
    this.retryDelayMs.set(delay);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connectActive(index);
    }, delay);
  }

  private scheduleHigherPriorityProbe(): void {
    this.clearUpgradeTimer();
    if (this.activeIndex === 0) {
      return;
    }

    this.upgradeTimer = setInterval(() => {
      if (this.started && navigator.onLine) {
        this.connectProbe(this.activeIndex - 1);
      }
    }, HIGHER_PRIORITY_RETRY_MS);
  }

  private connectProbe(index: number): void {
    if (this.probeTransport || index >= this.activeIndex) {
      return;
    }

    const transport = this.factory.create(TRANSPORT_ORDER[index]);
    const probeGeneration = ++this.probeGeneration;
    this.probeTransport = transport;
    this.probeTimer = setTimeout(
      () => this.failProbe(transport, probeGeneration),
      CONNECTION_TIMEOUT_MS,
    );
    transport.connect(this.createObserver(transport, index, probeGeneration, true));
  }

  private promoteProbe(transport: MetricTransport, index: number, probeGeneration: number): void {
    if (this.probeTransport !== transport || probeGeneration !== this.probeGeneration) {
      return;
    }

    this.clearProbeTimer();
    this.activeTransport?.close();
    this.activeTransport = transport;
    this.probeTransport = null;
    this.activeIndex = index;
    this.failureCount = 0;
    this.retryAttempt = 0;
    this.status.set(statusForKind(transport.kind));
    this.retryDelayMs.set(null);
    this.scheduleHigherPriorityProbe();
  }

  private failProbe(transport: MetricTransport, probeGeneration: number): void {
    if (this.probeTransport !== transport || probeGeneration !== this.probeGeneration) {
      return;
    }

    this.clearProbeTimer();
    transport.close();
    this.probeTransport = null;
  }

  private clearTimers(): void {
    this.clearConnectionTimer();
    this.clearProbeTimer();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.clearUpgradeTimer();
  }

  private clearConnectionTimer(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  private clearProbeTimer(): void {
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }

  private clearUpgradeTimer(): void {
    if (this.upgradeTimer) {
      clearInterval(this.upgradeTimer);
      this.upgradeTimer = null;
    }
  }
}

function statusForKind(kind: MetricTransportKind): MetricConnectionStatus {
  switch (kind) {
    case 'websocket':
      return 'live-websocket';
    case 'sse':
      return 'live-sse';
    case 'polling':
      return 'polling';
  }
}
