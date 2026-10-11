import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFleetData } from './fleet-data.js';

test('generates 2,000 ordered service IDs and bounded metric values', () => {
  const fleet = createFleetData(() => 1_000);
  const services = fleet.listServices();
  const snapshot = fleet.snapshot();

  assert.equal(services.length, 2_000);
  assert.equal(services[0].serviceId, 'svc-0001');
  assert.equal(services[1_999].serviceId, 'svc-2000');
  assert.equal(new Set(services.map((service) => service.serviceId)).size, 2_000);
  assert.equal(snapshot.offset, 0);
  assert.equal(snapshot.services.length, 2_000);

  for (const metric of snapshot.services) {
    assert.equal(metric.ts, 1_000);
    assert.ok(metric.p95 >= 0);
    assert.ok(metric.errRate >= 0 && metric.errRate <= 100);
    assert.ok(metric.rps >= 0);
    assert.ok(['healthy', 'degraded', 'down'].includes(metric.status));
  }
});
