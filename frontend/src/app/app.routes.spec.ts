import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { routes } from './app.routes';

describe('application protected routes', () => {
  let router: Router;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter(routes)],
    });
    router = TestBed.inject(Router);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('redirects a direct unauthenticated visit to settings to login with the return URL', async () => {
    const navigation = router.navigateByUrl('/settings');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const refresh = httpTesting.expectOne('/api/auth/refresh');
    refresh.flush(
      { error: { code: 'INVALID_REFRESH_TOKEN' } },
      { status: 401, statusText: 'Unauthorized' },
    );

    await navigation;
    expect(router.url).toBe('/login?returnUrl=%2Fsettings');
  });
});
