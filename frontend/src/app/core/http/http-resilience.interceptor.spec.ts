import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { HTTP_RESILIENCE } from './http-resilience.config';
import { httpResilienceInterceptor } from './http-resilience.interceptor';

describe('httpResilienceInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([httpResilienceInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    vi.useRealTimers();
  });

  it('retries retryable GET failures up to three total attempts', async () => {
    const response = firstValueFrom(http.get('/api/services'));
    httpTesting.expectOne('/api/services').flush({}, { status: 503, statusText: 'Unavailable' });
    await vi.advanceTimersByTimeAsync(250);
    httpTesting.expectOne('/api/services').flush({}, { status: 502, statusText: 'Bad Gateway' });
    await vi.advanceTimersByTimeAsync(500);
    httpTesting
      .expectOne('/api/services')
      .flush({}, { status: 504, statusText: 'Gateway Timeout' });

    await expect(response).rejects.toMatchObject({ status: 504 });
    httpTesting.expectNone('/api/services');
  });

  it('does not retry non-retryable 4xx responses or unsafe POST requests', async () => {
    const notFound = firstValueFrom(http.get('/api/services'));
    httpTesting.expectOne('/api/services').flush({}, { status: 404, statusText: 'Not Found' });
    await expect(notFound).rejects.toMatchObject({ status: 404 });

    const unsafePost = firstValueFrom(http.post('/api/rules', { name: 'Rule' }));
    httpTesting.expectOne('/api/rules').flush({}, { status: 503, statusText: 'Unavailable' });
    await expect(unsafePost).rejects.toMatchObject({ status: 503 });
    httpTesting.expectNone('/api/rules');
  });

  it('retries a POST only when it has a UUID idempotency key', async () => {
    const key = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const response = firstValueFrom(
      http.post('/api/rules', { name: 'Rule' }, { headers: { 'Idempotency-Key': key } }),
    );
    httpTesting.expectOne('/api/rules').flush({}, { status: 503, statusText: 'Unavailable' });
    await vi.advanceTimersByTimeAsync(250);
    httpTesting.expectOne('/api/rules').flush({ id: 'rule-1' });

    await expect(response).resolves.toEqual({ id: 'rule-1' });
  });

  it('respects Retry-After for HTTP 429', async () => {
    const response = firstValueFrom(http.get('/api/services'));
    httpTesting
      .expectOne('/api/services')
      .flush({}, { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '2' } });
    await vi.advanceTimersByTimeAsync(1_999);
    httpTesting.expectNone('/api/services');
    await vi.advanceTimersByTimeAsync(1);
    httpTesting.expectOne('/api/services').flush({ ok: true });

    await expect(response).resolves.toEqual({ ok: true });
  });

  it('times out a request after ten seconds', async () => {
    const response = firstValueFrom(http.get('/api/services'));
    httpTesting.expectOne('/api/services');
    await vi.advanceTimersByTimeAsync(HTTP_RESILIENCE.timeoutMs);
    await vi.advanceTimersByTimeAsync(HTTP_RESILIENCE.baseRetryDelayMs);
    httpTesting.expectOne('/api/services').flush({ ok: true });

    await expect(response).resolves.toEqual({ ok: true });
  });
});
