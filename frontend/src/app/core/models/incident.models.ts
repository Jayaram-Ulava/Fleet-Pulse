import { RuleMetric } from './rule.models';

export interface RuleIncident {
  readonly id: string;
  readonly ruleId: string;
  readonly ruleName: string;
  readonly serviceId: string;
  readonly metric: RuleMetric;
  readonly value: number;
  readonly firedAt: number;
}
