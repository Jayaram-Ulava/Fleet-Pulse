import { Component, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { MetricTransportManagerService } from './core/connection/metric-transport-manager.service';
import { RuleEvaluationService } from './core/connection/rule-evaluation.service';
import { ConnectionHealthService } from './core/connection/connection-health.service';
import { RuleIncident } from './core/models/incident.models';
import { DashboardSettingsService } from './core/settings/dashboard-settings.service';

@Component({
  selector: 'app-root',
  imports: [
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatIconModule,
    MatToolbarModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  templateUrl: './app-shell.html',
  styleUrl: './app-shell.scss',
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly transportManager = inject(MetricTransportManagerService);
  private readonly connectionHealth = inject(ConnectionHealthService);
  private readonly ruleEvaluator = inject(RuleEvaluationService);
  private readonly settingsService = inject(DashboardSettingsService);
  private readonly stopStreamWhenSignedOut = effect(() => {
    if (!this.auth.user()) {
      this.transportManager.stop();
    }
  });
  private readonly syncRuleEvaluation = effect(() => {
    if (this.auth.user()) {
      this.ruleEvaluator.start();
    } else {
      this.ruleEvaluator.stop();
    }
  });

  readonly user = this.auth.user;
  readonly incidents = this.ruleEvaluator.incidents;
  readonly settings = this.settingsService.settings;
  readonly isIncidentPanelOpen = signal(false);
  readonly connectionStatus = this.connectionHealth.status;
  readonly connectionLabel = this.connectionHealth.label;
  readonly dataAgeSeconds = this.connectionHealth.dataAgeSeconds;
  readonly retryDelayMs = this.transportManager.retryDelayMs;

  signOut(): void {
    this.auth.logout().subscribe(() => void this.router.navigate(['/login']));
  }

  toggleIncidentPanel(): void {
    this.isIncidentPanelOpen.update((isOpen) => !isOpen);
  }

  dismissIncident(incident: RuleIncident): void {
    this.ruleEvaluator.dismissIncident(incident.id);
  }
}
