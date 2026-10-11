import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { DashboardSettings } from '../models/dashboard-settings.models';

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  refreshIntervalSeconds: 2,
  compactRows: false,
  showIncidentPanel: true,
};

const SETTINGS_STORAGE_KEY = 'fleet-pulse-settings';

@Injectable({ providedIn: 'root' })
export class DashboardSettingsService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly settingsState = signal<DashboardSettings>({ ...DEFAULT_DASHBOARD_SETTINGS });

  readonly settings = this.settingsState.asReadonly();

  constructor() {
    this.restore();
  }

  save(settings: DashboardSettings): boolean {
    const validated = normalizeSettings(settings);
    this.settingsState.set(validated);
    if (!this.isBrowser) {
      return false;
    }

    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(validated));
      return true;
    } catch {
      return false;
    }
  }

  reset(): DashboardSettings {
    this.save(DEFAULT_DASHBOARD_SETTINGS);
    return this.settingsState();
  }

  private restore(): void {
    if (!this.isBrowser) {
      return;
    }

    try {
      const serializedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (serializedSettings) {
        this.settingsState.set(
          normalizeSettings(JSON.parse(serializedSettings) as Partial<DashboardSettings>),
        );
      }
    } catch {
      this.settingsState.set({ ...DEFAULT_DASHBOARD_SETTINGS });
    }
  }
}

function normalizeSettings(value: Partial<DashboardSettings>): DashboardSettings {
  const interval = value.refreshIntervalSeconds;
  const refreshIntervalSeconds =
    interval === 5 || interval === 10
      ? interval
      : DEFAULT_DASHBOARD_SETTINGS.refreshIntervalSeconds;

  return {
    refreshIntervalSeconds,
    compactRows: value.compactRows === true,
    showIncidentPanel: value.showIncidentPanel !== false,
  };
}
