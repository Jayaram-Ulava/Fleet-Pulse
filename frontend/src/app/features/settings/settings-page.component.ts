import { Component, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { DashboardSettings } from '../../core/models/dashboard-settings.models';
import { DashboardSettingsService } from '../../core/settings/dashboard-settings.service';
import { MetricTransportManagerService } from '../../core/connection/metric-transport-manager.service';

@Component({
  selector: 'app-settings-page',
  imports: [FormsModule, MatButtonModule, MatIconModule],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss',
})
export class SettingsPageComponent {
  private readonly settingsService = inject(DashboardSettingsService);
  private readonly transportManager = inject(MetricTransportManagerService);

  readonly savedMessage = signal<string | null>(null);
  readonly settings: DashboardSettings = { ...this.settingsService.settings() };

  save(form: NgForm): void {
    if (form.invalid) {
      form.control.markAllAsTouched();
      return;
    }

    const saved = this.settingsService.save(this.settings);
    this.transportManager.restartPollingIfActive();
    this.savedMessage.set(
      saved ? 'Preferences saved.' : 'Preferences could not be saved in this browser.',
    );
    form.form.markAsPristine();
  }

  reset(form: NgForm): void {
    Object.assign(this.settings, this.settingsService.reset());
    this.savedMessage.set(null);
    form.form.markAsDirty();
  }
}
