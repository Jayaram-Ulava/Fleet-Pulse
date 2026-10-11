import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard-page.component').then(
        (module) => module.DashboardPageComponent,
      ),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login-page.component').then((module) => module.LoginPageComponent),
  },
  {
    path: 'services/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/services/service-detail-page.component').then(
        (module) => module.ServiceDetailPageComponent,
      ),
  },
  {
    path: 'rules',
    canActivate: [roleGuard('operator')],
    canDeactivate: [(component) => component.canLeave()],
    loadComponent: () =>
      import('./features/rules/rules-page.component').then((module) => module.RulesPageComponent),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/settings-page.component').then(
        (module) => module.SettingsPageComponent,
      ),
  },
  { path: '**', redirectTo: '' },
];
