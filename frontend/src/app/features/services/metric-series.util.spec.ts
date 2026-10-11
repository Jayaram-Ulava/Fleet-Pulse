import { MAX_CHART_POINTS, downsampleMetricPoints } from './metric-series.util';

describe('downsampleMetricPoints', () => {
  it('aggregates large histories into at most 300 chronological time buckets', () => {
    const points = Array.from({ length: 1_200 }, (_, index) => ({
      ts: index * 1_000,
      p95: index,
      errRate: index / 100,
      rps: index * 2,
    }));

    const result = downsampleMetricPoints(points);

    expect(result).toHaveLength(MAX_CHART_POINTS);
    expect(result[0].ts).toBeLessThan(result.at(-1)?.ts ?? 0);
    expect(result[0].p95).toBeGreaterThanOrEqual(0);
    expect(result.at(-1)?.rps).toBeLessThan(points.at(-1)?.rps ?? 0);
  });

  it('keeps every point when the input is already within the limit', () => {
    const points = [
      { ts: 2, p95: 20, errRate: 0.2, rps: 2 },
      { ts: 1, p95: 10, errRate: 0.1, rps: 1 },
    ];

    expect(downsampleMetricPoints(points)).toEqual([points[1], points[0]]);
  });
});
