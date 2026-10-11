export type RuleMetric = 'p95' | 'errRate' | 'rps';
export type RuleOperator = '>' | '>=' | '<' | '<=';

export interface RuleCondition {
  readonly metric: RuleMetric;
  readonly operator: RuleOperator;
  readonly threshold: number;
  readonly durationSeconds: number;
}

export interface AlertRule {
  readonly id: string;
  readonly name: string;
  readonly conditions: readonly RuleCondition[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RulePayload {
  readonly name: string;
  readonly conditions: readonly RuleCondition[];
}
