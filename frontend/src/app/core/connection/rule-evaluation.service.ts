import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MetricEventStoreService } from './metric-event-store.service';
import { Subscription } from 'rxjs';
import { MetricEvent } from '../models/metric-event.models';
import { RuleIncident } from '../models/incident.models';
import { AlertRule, RuleCondition } from '../models/rule.models';
import { RulesApiService } from '../http/rules-api.service';

interface ConditionState {
  readonly startedAt: number;
  readonly incidentId: string | null;
}

@Injectable({ providedIn: 'root' })
export class RuleEvaluationService {
  private readonly eventStore = inject(MetricEventStoreService);
  private readonly rulesApi = inject(RulesApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly stateByCondition = new Map<string, ConditionState>();
  private eventSubscription: Subscription | null = null;
  private rulesSubscription: Subscription | null = null;

  readonly rules = signal<readonly AlertRule[]>([]);
  readonly incidents = signal<readonly RuleIncident[]>([]);

  start(): void {
    if (this.eventSubscription) {
      return;
    }
    this.eventSubscription = this.eventStore.events$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => this.process(event));
    this.rulesSubscription = this.rulesApi.list().subscribe({
      next: (response) => this.setRules(response.rules),
      error: () => console.error('Alert rules could not be loaded for evaluation.'),
    });
  }

  stop(): void {
    this.eventSubscription?.unsubscribe();
    this.eventSubscription = null;
    this.rulesSubscription?.unsubscribe();
    this.rulesSubscription = null;
    this.stateByCondition.clear();
    this.rules.set([]);
    this.incidents.set([]);
  }

  setRules(rules: readonly AlertRule[]): void {
    const activeRuleIds = new Set(rules.map((rule) => rule.id));
    for (const key of this.stateByCondition.keys()) {
      if (!activeRuleIds.has(key.split('::')[0])) {
        this.stateByCondition.delete(key);
      }
    }
    this.rules.set(rules);
  }

  process(event: MetricEvent): void {
    for (const rule of this.rules()) {
      for (const [conditionIndex, condition] of rule.conditions.entries()) {
        const key = conditionStateKey(rule.id, event.serviceId, conditionIndex);
        const value = event[condition.metric];
        if (!conditionMatches(value, condition)) {
          this.stateByCondition.delete(key);
          continue;
        }

        const currentState = this.stateByCondition.get(key);
        if (currentState?.incidentId) {
          continue;
        }

        const startedAt = currentState?.startedAt ?? event.ts;
        if (event.ts - startedAt < condition.durationSeconds * 1_000) {
          this.stateByCondition.set(key, { startedAt, incidentId: null });
          continue;
        }

        const incident: RuleIncident = {
          id: crypto.randomUUID(),
          ruleId: rule.id,
          ruleName: rule.name,
          serviceId: event.serviceId,
          metric: condition.metric,
          value,
          firedAt: event.ts,
        };
        this.stateByCondition.set(key, { startedAt, incidentId: incident.id });
        this.incidents.update((incidents) => [incident, ...incidents]);
      }
    }
  }

  dismissIncident(incidentId: string): void {
    this.incidents.update((incidents) =>
      incidents.filter((incident) => incident.id !== incidentId),
    );
  }
}

function conditionStateKey(ruleId: string, serviceId: string, conditionIndex: number): string {
  return `${ruleId}::${serviceId}::${conditionIndex}`;
}

function conditionMatches(value: number, condition: RuleCondition): boolean {
  switch (condition.operator) {
    case '>':
      return value > condition.threshold;
    case '>=':
      return value >= condition.threshold;
    case '<':
      return value < condition.threshold;
    case '<=':
      return value <= condition.threshold;
  }
}
