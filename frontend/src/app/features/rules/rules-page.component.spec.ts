import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { RulesPageComponent } from './rules-page.component';

describe('RulesPageComponent', () => {
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RulesPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    vi.useRealTimers();
  });

  it('optimistically inserts a rule with an idempotency key and rolls it back on failure', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(RulesPageComponent);
    fixture.detectChanges();
    httpTesting.expectOne('/api/rules').flush({ rules: [] });

    const page = fixture.componentInstance;
    page.startCreate();
    page.ruleForm.controls.name.setValue('Checkout latency');
    await vi.advanceTimersByTimeAsync(300);
    httpTesting.expectOne('/api/rules/check-name?name=Checkout+latency').flush({ available: true });

    page.saveRule();
    expect(page.rules()).toHaveLength(1);
    expect(page.rules()[0].id).toMatch(/^pending-/);

    const createRequest = httpTesting.expectOne('/api/rules');
    expect(createRequest.request.method).toBe('POST');
    expect(createRequest.request.headers.get('Idempotency-Key')).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i,
    );
    createRequest.flush(
      { error: { code: 'SERVER_ERROR' } },
      { status: 500, statusText: 'Server Error' },
    );

    expect(page.rules()).toEqual([]);
    expect(page.isSaving()).toBe(false);
    expect(page.saveError()).toContain('rolled back');
  });
});
