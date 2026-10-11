import { ServiceStatus } from './fleet.models';

export interface MetricEvent {
  readonly type: 'metric';
  readonly offset: number;
  readonly serviceId: string;
  readonly seq: number;
  readonly ts: number;
  readonly p95: number;
  readonly errRate: number;
  readonly rps: number;
  readonly status: ServiceStatus;
}

export interface ReplayResponse {
  readonly events: readonly unknown[];
}

export interface StreamDiagnostics {
  readonly duplicates: number;
  readonly gaps: number;
  readonly replayRequests: number;
  readonly malformed: number;
}

export interface MetricHistoryPoint {
  readonly ts: number;
  readonly p95: number;
  readonly errRate: number;
  readonly rps: number;
}

export interface ServiceMetricHistory {
  readonly serviceId: string;
  readonly minutes: number;
  readonly points: readonly MetricHistoryPoint[];
}
