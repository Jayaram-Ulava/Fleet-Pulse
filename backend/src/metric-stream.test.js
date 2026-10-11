import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFleetData } from './fleet-data.js';
import { createMetricStream } from './metric-stream.js';

test('generates increasing global offsets and per-service sequences', () => {
  let timestamp = 1_000;
  const fleet = createFleetData(() => timestamp++);
  const stream = createMetricStream(fleet, { now: () => timestamp++ });
  const firstEvent = stream.generateOne();
  const secondEvent = stream.generateOne();

  assert.equal(firstEvent.offset, 1);
  assert.equal(secondEvent.offset, 2);
  assert.equal(firstEvent.seq, 2);
  assert.equal(secondEvent.seq, 2);
  assert.equal(stream.snapshot().offset, 2);
  assert.equal(stream.snapshot().services[0].seq, 2);
});

test('retains events in offset order and returns 410-compatible null for expired history', () => {
  const stream = createMetricStream(createFleetData(), { historyLimit: 2 });
  stream.generateOne();
  stream.generateOne();
  stream.generateOne();

  assert.equal(stream.replay(0), null);
  assert.deepEqual(
    stream.replay(1).map((event) => event.offset),
    [2, 3],
  );
});
