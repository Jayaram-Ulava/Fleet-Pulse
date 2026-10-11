import {
  AbstractControl,
  AsyncValidatorFn,
  FormArray,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import { catchError, map, of, switchMap, timer } from 'rxjs';
import { RulesApiService } from '../../core/http/rules-api.service';
import { RuleMetric } from '../../core/models/rule.models';

const METRIC_RANGES: Record<RuleMetric, { readonly minimum: number; readonly maximum: number }> = {
  p95: { minimum: 0, maximum: 60_000 },
  errRate: { minimum: 0, maximum: 100 },
  rps: { minimum: 0, maximum: 1_000_000 },
};

export const metricThresholdRangeValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const metric = control.get('metric')?.value as RuleMetric | undefined;
  const threshold = control.get('threshold')?.value;
  const range = metric ? METRIC_RANGES[metric] : undefined;

  if (!range || typeof threshold !== 'number' || !Number.isFinite(threshold)) {
    return null;
  }

  return threshold < range.minimum || threshold > range.maximum
    ? { metricThresholdRange: { metric, ...range } }
    : null;
};

export const validRuleConditionSetValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const conditions = control as FormArray;
  if (conditions.length === 0) {
    return { atLeastOneCondition: true };
  }

  const signatures = conditions.controls.map((condition) =>
    ['metric', 'operator', 'threshold', 'durationSeconds']
      .map((key) => condition.get(key)?.value)
      .join(':'),
  );
  return new Set(signatures).size !== signatures.length ? { duplicateCondition: true } : null;
};

export function uniqueRuleNameValidator(
  rulesApi: RulesApiService,
  excludeId: () => string | null,
): AsyncValidatorFn {
  return (control) => {
    const name = String(control.value ?? '').trim();
    if (name.length < 3) {
      return of(null);
    }

    return timer(300).pipe(
      switchMap(() => rulesApi.checkName(name, excludeId())),
      map((result) => (result.available ? null : { uniqueRuleName: true })),
      catchError(() => of({ ruleNameCheckFailed: true })),
    );
  };
}
