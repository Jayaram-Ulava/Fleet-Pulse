import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  AlertRule,
  RuleCondition,
  RuleMetric,
  RuleOperator,
  RulePayload,
} from '../../core/models/rule.models';
import { RuleEvaluationService } from '../../core/connection/rule-evaluation.service';
import { RulesApiService } from '../../core/http/rules-api.service';
import {
  metricThresholdRangeValidator,
  uniqueRuleNameValidator,
  validRuleConditionSetValidator,
} from './rule-form.validators';

type ConditionFormGroup = FormGroup<{
  metric: FormControl<RuleMetric>;
  operator: FormControl<RuleOperator>;
  threshold: FormControl<number>;
  durationSeconds: FormControl<number>;
}>;

type RuleFormGroup = FormGroup<{
  name: FormControl<string>;
  conditions: FormArray<ConditionFormGroup>;
}>;

@Component({
  selector: 'app-rules-page',
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
  ],
  templateUrl: './rules-page.component.html',
  styleUrl: './rules-page.component.scss',
})
export class RulesPageComponent implements OnInit {
  private readonly rulesApi = inject(RulesApiService);
  private readonly evaluator = inject(RuleEvaluationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly rules = signal<readonly AlertRule[]>([]);
  readonly isLoading = signal(true);
  readonly isSaving = signal(false);
  readonly listError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly isEditorOpen = signal(false);
  readonly editingRuleId = signal<string | null>(null);

  readonly ruleForm: RuleFormGroup = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3), Validators.maxLength(80)],
      asyncValidators: [uniqueRuleNameValidator(this.rulesApi, () => this.editingRuleId())],
      updateOn: 'change',
    }),
    conditions: new FormArray<ConditionFormGroup>([], {
      validators: [validRuleConditionSetValidator],
    }),
  });

  get conditions(): FormArray<ConditionFormGroup> {
    return this.ruleForm.controls.conditions;
  }

  ngOnInit(): void {
    this.loadRules();
  }

  loadRules(): void {
    this.isLoading.set(true);
    this.listError.set(null);
    this.rulesApi
      .list()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.rules.set(response.rules);
          this.evaluator.setRules(response.rules);
          this.isLoading.set(false);
        },
        error: () => {
          this.listError.set('Alert rules could not be loaded. Please retry.');
          this.isLoading.set(false);
        },
      });
  }

  startCreate(): void {
    this.editingRuleId.set(null);
    this.saveError.set(null);
    this.ruleForm.reset({ name: '' });
    this.conditions.clear();
    this.conditions.push(this.createConditionGroup());
    this.ruleForm.markAsPristine();
    this.isEditorOpen.set(true);
  }

  editRule(rule: AlertRule): void {
    this.rulesApi
      .get(rule.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (loadedRule) => {
          this.editingRuleId.set(loadedRule.id);
          this.saveError.set(null);
          this.ruleForm.controls.name.setValue(loadedRule.name);
          this.conditions.clear();
          for (const condition of loadedRule.conditions) {
            this.conditions.push(this.createConditionGroup(condition));
          }
          this.ruleForm.markAsPristine();
          this.isEditorOpen.set(true);
        },
        error: () => this.saveError.set('This rule could not be opened. Please retry.'),
      });
  }

  addCondition(): void {
    this.conditions.push(this.createConditionGroup());
    this.conditions.markAsDirty();
  }

  removeCondition(index: number): void {
    this.conditions.removeAt(index);
    this.conditions.markAsDirty();
  }

  saveRule(): void {
    this.ruleForm.markAllAsTouched();
    this.saveError.set(null);
    if (this.ruleForm.invalid || this.isSaving()) {
      return;
    }

    const payload = this.toPayload();
    const currentRuleId = this.editingRuleId();
    this.isSaving.set(true);
    if (currentRuleId) {
      this.updateOptimistically(currentRuleId, payload);
    } else {
      this.createOptimistically(payload);
    }
  }

  deleteRule(rule: AlertRule): void {
    if (!window.confirm(`Delete the rule "${rule.name}"?`)) {
      return;
    }

    const previousRules = this.rules();
    this.rules.set(previousRules.filter((candidate) => candidate.id !== rule.id));
    this.evaluator.setRules(this.rules());
    this.rulesApi
      .delete(rule.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          this.rules.set(previousRules);
          this.evaluator.setRules(previousRules);
          this.listError.set('The rule could not be deleted. Your list was restored.');
        },
      });
  }

  cancelEditor(): void {
    if (this.ruleForm.dirty && !window.confirm('Discard unsaved rule changes?')) {
      return;
    }

    this.isEditorOpen.set(false);
    this.saveError.set(null);
  }

  canLeave(): boolean {
    return (
      !this.isEditorOpen() ||
      !this.ruleForm.dirty ||
      window.confirm('Discard unsaved rule changes?')
    );
  }

  fieldError(control: AbstractControl | null, label: string): string | null {
    if (!control?.touched || !control.errors) {
      return null;
    }
    if (control.hasError('required')) {
      return `${label} is required.`;
    }
    if (control.hasError('min')) {
      return `${label} must be at least ${control.getError('min').min}.`;
    }
    if (control.hasError('max')) {
      return `${label} must be at most ${control.getError('max').max}.`;
    }
    if (control.hasError('metricThresholdRange')) {
      const range = control.getError('metricThresholdRange') as {
        minimum: number;
        maximum: number;
      };
      return `${label} must be between ${range.minimum} and ${range.maximum} for this metric.`;
    }
    return null;
  }

  private createConditionGroup(condition?: RuleCondition): ConditionFormGroup {
    return new FormGroup(
      {
        metric: new FormControl<RuleMetric>(condition?.metric ?? 'p95', { nonNullable: true }),
        operator: new FormControl<RuleOperator>(condition?.operator ?? '>', { nonNullable: true }),
        threshold: new FormControl(condition?.threshold ?? 500, {
          nonNullable: true,
          validators: [Validators.required, Validators.min(0)],
        }),
        durationSeconds: new FormControl(condition?.durationSeconds ?? 60, {
          nonNullable: true,
          validators: [Validators.required, Validators.min(1), Validators.max(86_400)],
        }),
      },
      { validators: [metricThresholdRangeValidator] },
    );
  }

  private toPayload(): RulePayload {
    const value = this.ruleForm.getRawValue();
    return {
      name: value.name.trim(),
      conditions: value.conditions.map((condition) => ({ ...condition })),
    };
  }

  private createOptimistically(payload: RulePayload): void {
    const idempotencyKey = crypto.randomUUID();
    const optimisticId = `pending-${idempotencyKey}`;
    const optimisticRule: AlertRule = {
      id: optimisticId,
      name: payload.name,
      conditions: payload.conditions,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.rules.update((rules) => [optimisticRule, ...rules]);

    this.rulesApi
      .create(payload, idempotencyKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (savedRule) => {
          this.rules.update((rules) =>
            rules.map((rule) => (rule.id === optimisticId ? savedRule : rule)),
          );
          this.evaluator.setRules(this.rules());
          this.finishSave();
        },
        error: (error: unknown) => {
          this.rules.update((rules) => rules.filter((rule) => rule.id !== optimisticId));
          this.evaluator.setRules(this.rules());
          this.saveError.set(
            error instanceof HttpErrorResponse && error.status === 409
              ? 'A rule with this name already exists.'
              : 'The rule could not be saved. The optimistic entry was rolled back.',
          );
          this.isSaving.set(false);
        },
      });
  }

  private updateOptimistically(ruleId: string, payload: RulePayload): void {
    const previousRules = this.rules();
    this.rules.update((rules) =>
      rules.map((rule) =>
        rule.id === ruleId ? { ...rule, ...payload, updatedAt: new Date().toISOString() } : rule,
      ),
    );
    this.evaluator.setRules(this.rules());

    this.rulesApi
      .update(ruleId, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (savedRule) => {
          this.rules.update((rules) =>
            rules.map((rule) => (rule.id === ruleId ? savedRule : rule)),
          );
          this.evaluator.setRules(this.rules());
          this.finishSave();
        },
        error: () => {
          this.rules.set(previousRules);
          this.evaluator.setRules(previousRules);
          this.saveError.set('The rule could not be updated. Your previous rule was restored.');
          this.isSaving.set(false);
        },
      });
  }

  private finishSave(): void {
    this.isSaving.set(false);
    this.isEditorOpen.set(false);
    this.ruleForm.markAsPristine();
  }
}
