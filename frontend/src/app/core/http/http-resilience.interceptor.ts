import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { retry, throwError, timer, TimeoutError, timeout } from 'rxjs';
import { HTTP_RESILIENCE, RETRYABLE_HTTP_STATUSES } from './http-resilience.config';

const UUID_PATTERN = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function retryDelayFor(
  error: unknown,
  request: HttpRequest<unknown>,
  retryAttempt: number,
  now = Date.now,
): number | null {
  const canRetryMethod =
    request.method === 'GET' ||
    (request.method === 'POST' && UUID_PATTERN.test(request.headers.get('Idempotency-Key') ?? ''));
  if (!canRetryMethod) {
    return null;
  }

  const retryableFailure =
    error instanceof TimeoutError ||
    (error instanceof HttpErrorResponse &&
      (error.status === 0 || RETRYABLE_HTTP_STATUSES.has(error.status)));
  if (!retryableFailure) {
    return null;
  }

  if (error instanceof HttpErrorResponse && error.status === 429) {
    const retryAfter = error.headers.get('Retry-After');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1_000);
      }

      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) {
        return Math.max(0, retryAt - now());
      }
    }
  }

  return Math.min(
    HTTP_RESILIENCE.maxRetryDelayMs,
    HTTP_RESILIENCE.baseRetryDelayMs * 2 ** Math.max(0, retryAttempt - 1),
  );
}

export const httpResilienceInterceptor: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    timeout({ each: HTTP_RESILIENCE.timeoutMs }),
    retry({
      count: HTTP_RESILIENCE.maxAttempts - 1,
      delay: (error: unknown, retryAttempt: number) => {
        const delay = retryDelayFor(error, request, retryAttempt);
        return delay === null ? throwError(() => error) : timer(delay);
      },
    }),
  );
