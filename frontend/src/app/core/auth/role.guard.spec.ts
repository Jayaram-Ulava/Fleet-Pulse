import { Component } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';
import { roleGuard } from './role.guard';

@Component({ standalone: true, template: 'protected rules' })
class RulesPageStub {}

@Component({ standalone: true, template: 'home' })
class HomePageStub {}

@Component({ standalone: true, template: 'login' })
class LoginPageStub {}

describe('roleGuard', () => {
  let httpTesting: HttpTestingController;
  let router: Router;
  let auth: AuthService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([])),
        provideHttpClientTesting(),
        provideRouter([
          { path: '', component: HomePageStub },
          { path: 'login', component: LoginPageStub },
          {
            path: 'rules',
            canActivate: [roleGuard('operator')],
            component: RulesPageStub,
          },
        ]),
      ],
    });

    httpTesting = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => httpTesting.verify());

  it('redirects a viewer away from the protected rules route', async () => {
    const login = firstValueFrom(auth.login({ email: 'viewer@pulse.dev', password: 'pulse123' }));
    httpTesting.expectOne('/api/auth/login').flush({
      accessToken: 'viewer-token',
      user: { id: 'viewer-1', email: 'viewer@pulse.dev', role: 'viewer' },
    });
    await login;

    await router.navigateByUrl('/rules');
    expect(router.url).toBe('/?accessDenied=true');
  });

  it('allows an operator to open the protected rules route', async () => {
    const login = firstValueFrom(auth.login({ email: 'operator@pulse.dev', password: 'pulse123' }));
    httpTesting.expectOne('/api/auth/login').flush({
      accessToken: 'operator-token',
      user: { id: 'operator-1', email: 'operator@pulse.dev', role: 'operator' },
    });
    await login;

    await router.navigateByUrl('/rules');
    expect(router.url).toBe('/rules');
  });
});
