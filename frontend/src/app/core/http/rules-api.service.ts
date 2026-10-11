import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AlertRule, RulePayload } from '../models/rule.models';

@Injectable({ providedIn: 'root' })
export class RulesApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<{ readonly rules: readonly AlertRule[] }> {
    return this.http.get<{ readonly rules: readonly AlertRule[] }>(
      `${environment.apiBaseUrl}/rules`,
    );
  }

  get(ruleId: string): Observable<AlertRule> {
    return this.http.get<AlertRule>(`${environment.apiBaseUrl}/rules/${ruleId}`);
  }

  checkName(name: string, excludeId: string | null): Observable<{ readonly available: boolean }> {
    const query = new URLSearchParams({ name });
    if (excludeId) {
      query.set('excludeId', excludeId);
    }
    return this.http.get<{ readonly available: boolean }>(
      `${environment.apiBaseUrl}/rules/check-name?${query.toString()}`,
    );
  }

  create(payload: RulePayload, idempotencyKey: string): Observable<AlertRule> {
    return this.http.post<AlertRule>(`${environment.apiBaseUrl}/rules`, payload, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  update(ruleId: string, payload: RulePayload): Observable<AlertRule> {
    return this.http.put<AlertRule>(`${environment.apiBaseUrl}/rules/${ruleId}`, payload);
  }

  delete(ruleId: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}/rules/${ruleId}`);
  }
}
