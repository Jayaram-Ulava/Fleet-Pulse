import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, finalize, map, Observable, of, shareReplay, tap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthenticatedUser, AuthResponse, LoginCredentials } from './auth.models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly accessTokenState = signal<string | null>(null);
  private refreshRequest: Observable<string> | null = null;

  readonly user = signal<AuthenticatedUser | null>(null);
  readonly isAuthenticated = computed(
    () => this.user() !== null && this.accessTokenState() !== null,
  );

  accessToken(): string | null {
    return this.accessTokenState();
  }

  login(credentials: LoginCredentials): Observable<AuthenticatedUser> {
    return this.http
      .post<AuthResponse>(`${environment.apiBaseUrl}/auth/login`, credentials, {
        withCredentials: true,
      })
      .pipe(
        tap((response) => this.acceptSession(response)),
        map((response) => response.user),
      );
  }

  refresh(): Observable<string> {
    if (this.refreshRequest) {
      return this.refreshRequest;
    }

    this.refreshRequest = this.http
      .post<AuthResponse>(`${environment.apiBaseUrl}/auth/refresh`, {}, { withCredentials: true })
      .pipe(
        tap((response) => this.acceptSession(response)),
        map((response) => response.accessToken),
        catchError((error: unknown) => {
          this.clearSession();
          return throwError(() => error);
        }),
        finalize(() => {
          this.refreshRequest = null;
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );

    return this.refreshRequest;
  }

  ensureSession(): Observable<boolean> {
    if (this.isAuthenticated()) {
      return of(true);
    }

    return this.refresh().pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }

  logout(): Observable<void> {
    return this.http
      .post<void>(`${environment.apiBaseUrl}/auth/logout`, {}, { withCredentials: true })
      .pipe(
        catchError(() => of(undefined)),
        tap(() => this.clearSession()),
      );
  }

  clearSession(): void {
    this.accessTokenState.set(null);
    this.user.set(null);
  }

  private acceptSession(response: AuthResponse): void {
    this.accessTokenState.set(response.accessToken);
    this.user.set(response.user);
  }
}
