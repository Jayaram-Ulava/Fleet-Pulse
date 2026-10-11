import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MetricEvent } from '../models/metric-event.models';
import { AlertRule } from '../models/rule.models';
import { RuleEvaluationService } from './rule-evaluation.service';

function rule(durationSeconds = 2): AlertRule {
  return {
    id: 'rule-latency',
    name: 'Sustained latency',
    conditions: [{ metric: 'p95', operator: '>=', threshold: 500, durationSeconds }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function event(ts: number, p95: number): MetricEvent {
  return {
    type: 'metric',
    offset: ts,
    serviceId: 'svc-0001',
    seq: ts,
    ts,
    p95,
    errRate: 0.2,
    rps: 50,
    status: 'degraded',
  };
}

describe('RuleEvaluationService', () => {
  let evaluator: RuleEvaluationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    evaluator = TestBed.inject(RuleEvaluationService);
  });

  it('waits for the configured duration and prevents duplicate active incidents', () => {
    evaluator.setRules([rule()]);
    evaluator.process(event(1_000, 600));
    evaluator.process(event(2_000, 650));
    expect(evaluator.incidents()).toHaveLength(0);

    evaluator.process(event(3_000, 700));
    evaluator.process(event(4_000, 710));
    expect(evaluator.incidents()).toHaveLength(1);
    expect(evaluator.incidents()[0]).toMatchObject({
      ruleId: 'rule-latency',
      ruleName: 'Sustained latency',
      serviceId: 'svc-0001',
      metric: 'p95',
      value: 700,
      firedAt: 3_000,
    });
  });

  it('resets the duration when the condition becomes false', () => {
    evaluator.setRules([rule()]);
    evaluator.process(event(1_000, 600));
    evaluator.process(event(2_000, 300));
    evaluator.process(event(3_000, 600));
    evaluator.process(event(4_000, 600));
    expect(evaluator.incidents()).toHaveLength(0);

    evaluator.process(event(5_000, 600));
    expect(evaluator.incidents()).toHaveLength(1);
  });
});
