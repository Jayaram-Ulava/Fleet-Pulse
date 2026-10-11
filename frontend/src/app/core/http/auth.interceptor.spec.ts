import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('uses one refresh request for concurrent expired-token responses', async () => {
    const firstResponse = firstValueFrom(http.get<{ ok: boolean }>('/api/services'));
    const secondResponse = firstValueFrom(http.get<{ ok: boolean }>('/api/metrics/snapshot'));
    const expiredRequests = httpTesting.match((request) => request.url.startsWith('/api/'));

    expect(expiredRequests.length).toBe(2);
    expiredRequests.forEach((request) =>
      request.flush(
        { error: { code: 'ACCESS_TOKEN_EXPIRED' } },
        { status: 401, statusText: 'Unauthorized' },
      ),
    );

    const refreshRequest = httpTesting.expectOne('/api/auth/refresh');
    expect(refreshRequest.request.method).toBe('POST');
    expect(refreshRequest.request.withCredentials).toBe(true);
    refreshRequest.flush({
      accessToken: 'fresh-access-token',
      user: { id: 'operator-1', email: 'operator@pulse.dev', role: 'operator' },
    });

    const replayedRequests = httpTesting.match((request) =>
      ['/api/services', '/api/metrics/snapshot'].includes(request.url),
    );
    expect(replayedRequests.length).toBe(2);
    replayedRequests.forEach((request) => {
      expect(request.request.headers.get('Authorization')).toBe('Bearer fresh-access-token');
      request.flush({ ok: true });
    });

    const responses = await Promise.all([firstResponse, secondResponse]);
    expect(responses).toEqual([{ ok: true }, { ok: true }]);
    expect(TestBed.inject(AuthService).accessToken()).toBe('fresh-access-token');
  });

  it('does not replay a POST without a UUID idempotency key', async () => {
    const response = firstValueFrom(http.post('/api/rules', { name: 'High latency' }));
    httpTesting
      .expectOne('/api/rules')
      .flush(
        { error: { code: 'ACCESS_TOKEN_EXPIRED' } },
        { status: 401, statusText: 'Unauthorized' },
      );

    await expect(response).rejects.toMatchObject({ status: 401 });
    httpTesting.expectNone('/api/auth/refresh');
  });
});
