export type ServiceStatus = 'healthy' | 'degraded' | 'down';

export interface FleetService {
  readonly serviceId: string;
  readonly name: string;
  readonly team: string;
}

export interface ServiceMetric {
  readonly serviceId: string;
  readonly seq: number;
  readonly ts: number;
  readonly p95: number;
  readonly errRate: number;
  readonly rps: number;
  readonly status: ServiceStatus;
}

export interface FleetSnapshot {
  readonly offset: number;
  readonly services: readonly ServiceMetric[];
}

export interface FleetServiceRow extends FleetService {
  readonly status: ServiceStatus;
  readonly p95: number;
  readonly errRate: number;
  readonly rps: number;
}
