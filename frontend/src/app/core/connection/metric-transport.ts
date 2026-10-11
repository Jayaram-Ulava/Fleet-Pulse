import { FleetSnapshot } from '../models/fleet.models';

export type MetricTransportKind = 'websocket' | 'sse' | 'polling';

export interface MetricTransportObserver {
  readonly connected: () => void;
  readonly event: (value: unknown) => void;
  readonly snapshot: (value: FleetSnapshot) => void;
  readonly failed: (error: unknown) => void;
}

export interface MetricTransport {
  readonly kind: MetricTransportKind;
  connect(observer: MetricTransportObserver): void;
  close(): void;
}
