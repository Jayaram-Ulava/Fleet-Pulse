import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { UserRole } from './auth.models';
import { AuthService } from './auth.service';

export function roleGuard(...allowedRoles: UserRole[]): CanActivateFn {
  return (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    return auth.ensureSession().pipe(
      map((hasSession) => {
        const roleIsAllowed = allowedRoles.includes(auth.user()?.role ?? 'viewer');
        if (hasSession && roleIsAllowed) {
          return true;
        }

        return hasSession
          ? router.createUrlTree(['/'], { queryParams: { accessDenied: 'true' } })
          : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
      }),
    );
  };
}
