import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { RulesApiService } from '../../core/http/rules-api.service';
import {
  metricThresholdRangeValidator,
  uniqueRuleNameValidator,
  validRuleConditionSetValidator,
} from './rule-form.validators';

type TestConditionGroup = FormGroup<{
  metric: FormControl<string | null>;
  operator: FormControl<string | null>;
  threshold: FormControl<number | null>;
  durationSeconds: FormControl<number | null>;
}>;

describe('rule form validators', () => {
  let rulesApi: RulesApiService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    rulesApi = TestBed.inject(RulesApiService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    vi.useRealTimers();
  });

  it('validates thresholds against the selected metric in the parent condition group', () => {
    const condition = new FormGroup(
      {
        metric: new FormControl('errRate'),
        operator: new FormControl('>'),
        threshold: new FormControl(101),
        durationSeconds: new FormControl(30),
      },
      { validators: [metricThresholdRangeValidator] },
    );

    expect(condition.hasError('metricThresholdRange')).toBe(true);
    condition.controls.threshold.setValue(3);
    expect(condition.hasError('metricThresholdRange')).toBe(false);
  });

  it('requires at least one condition and rejects duplicate condition groups', () => {
    const conditions = new FormArray<TestConditionGroup>([], {
      validators: [validRuleConditionSetValidator],
    });
    expect(conditions.hasError('atLeastOneCondition')).toBe(true);

    const condition = (): TestConditionGroup =>
      new FormGroup({
        metric: new FormControl('p95'),
        operator: new FormControl('>'),
        threshold: new FormControl(500),
        durationSeconds: new FormControl(60),
      });
    conditions.push(condition());
    conditions.push(condition());

    expect(conditions.hasError('duplicateCondition')).toBe(true);
  });

  it('cancels outdated async checks and excludes the current rule during edits', async () => {
    vi.useFakeTimers();
    const currentRuleId = 'rule-current';
    const control = new FormControl('Initial name', {
      asyncValidators: [uniqueRuleNameValidator(rulesApi, () => currentRuleId)],
    });

    control.setValue('Checkout latency');
    await vi.advanceTimersByTimeAsync(300);

    httpTesting.expectNone((request) => request.urlWithParams.includes('Initial%20name'));
    const request = httpTesting.expectOne(
      '/api/rules/check-name?name=Checkout+latency&excludeId=rule-current',
    );
    request.flush({ available: false });

    expect(control.hasError('uniqueRuleName')).toBe(true);
  });
});
