import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';

const AUTH_REFRESH_RETRIED = new HttpContextToken<boolean>(() => false);

function isAuthRequest(url: string): boolean {
  return url.startsWith(`${environment.apiBaseUrl}/auth/`);
}

function canReplayRequest(method: string, idempotencyKey: string | null): boolean {
  if (method !== 'POST') {
    return true;
  }

  return (
    idempotencyKey !== null &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(idempotencyKey)
  );
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const authRequest = isAuthRequest(request.url);
  const token = auth.accessToken();
  const outgoingRequest =
    !authRequest && token
      ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : request;

  return next(outgoingRequest).pipe(
    catchError((error: unknown) => {
      if (
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        authRequest ||
        request.context.get(AUTH_REFRESH_RETRIED) ||
        !canReplayRequest(request.method, request.headers.get('Idempotency-Key'))
      ) {
        return throwError(() => error);
      }

      return auth.refresh().pipe(
        switchMap((freshToken) =>
          next(
            request.clone({
              context: request.context.set(AUTH_REFRESH_RETRIED, true),
              setHeaders: { Authorization: `Bearer ${freshToken}` },
            }),
          ),
        ),
        catchError((refreshError: unknown) => {
          auth.clearSession();
          if (router.url !== '/login') {
            void router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
          }
          return throwError(() => refreshError);
        }),
      );
    }),
  );
};
