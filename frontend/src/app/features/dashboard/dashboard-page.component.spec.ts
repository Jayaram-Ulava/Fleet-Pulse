import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardPageComponent } from './dashboard-page.component';

describe('DashboardPageComponent', () => {
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DashboardPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('joins fleet inventory with metrics and filters sorted rows', () => {
    const fixture = TestBed.createComponent(DashboardPageComponent);
    fixture.detectChanges();

    httpTesting.expectOne('/api/services').flush({
      services: [
        { serviceId: 'svc-0001', name: 'checkout', team: 'Payments' },
        { serviceId: 'svc-0002', name: 'identity', team: 'Identity' },
        { serviceId: 'svc-0003', name: 'ledger', team: 'Payments' },
      ],
    });
    httpTesting.expectOne('/api/metrics/snapshot').flush({
      offset: 0,
      services: [
        {
          serviceId: 'svc-0001',
          seq: 1,
          ts: 1_000,
          p95: 80,
          errRate: 0.2,
          rps: 140,
          status: 'healthy',
        },
        {
          serviceId: 'svc-0002',
          seq: 1,
          ts: 1_000,
          p95: 310,
          errRate: 1.4,
          rps: 42,
          status: 'down',
        },
        {
          serviceId: 'svc-0003',
          seq: 1,
          ts: 1_000,
          p95: 190,
          errRate: 0.4,
          rps: 90,
          status: 'degraded',
        },
      ],
    });

    const dashboard = fixture.componentInstance;
    expect(dashboard.rows().map((row) => row.serviceId)).toEqual([
      'svc-0001',
      'svc-0002',
      'svc-0003',
    ]);
    expect(dashboard.healthyCount()).toBe(1);
    expect(dashboard.degradedCount()).toBe(1);
    expect(dashboard.downCount()).toBe(1);

    dashboard.sortBy('p95');
    expect(dashboard.rows().map((row) => row.p95)).toEqual([80, 190, 310]);

    dashboard.setStatusFilter('down');
    expect(dashboard.rows().map((row) => row.serviceId)).toEqual(['svc-0002']);

    dashboard.searchTerm.set('payment');
    expect(dashboard.rows()).toEqual([]);
  });
});
