import { TestBed } from '@angular/core/testing';
import { NgForm } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { SettingsPageComponent } from './settings-page.component';
import { DashboardSettingsService } from '../../core/settings/dashboard-settings.service';

describe('SettingsPageComponent', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ imports: [SettingsPageComponent] });
  });

  it('saves template-driven preferences and can reset them to defaults', () => {
    const fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const form = fixture.debugElement.query(By.directive(NgForm)).injector.get(NgForm);

    component.settings.refreshIntervalSeconds = 5;
    component.settings.compactRows = true;
    component.save(form);

    expect(TestBed.inject(DashboardSettingsService).settings()).toEqual({
      refreshIntervalSeconds: 5,
      compactRows: true,
      showIncidentPanel: true,
    });
    expect(JSON.parse(localStorage.getItem('fleet-pulse-settings') ?? '{}')).toMatchObject({
      refreshIntervalSeconds: 5,
      compactRows: true,
    });

    component.reset(form);
    expect(component.settings).toEqual({
      refreshIntervalSeconds: 2,
      compactRows: false,
      showIncidentPanel: true,
    });
  });
});
