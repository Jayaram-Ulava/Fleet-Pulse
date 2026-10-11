import { MetricHistoryPoint } from '../../core/models/metric-event.models';

export const MAX_CHART_POINTS = 300;

export function downsampleMetricPoints(
  points: readonly MetricHistoryPoint[],
  maximumPoints = MAX_CHART_POINTS,
): MetricHistoryPoint[] {
  if (maximumPoints <= 0 || points.length === 0) {
    return [];
  }

  const sortedPoints = [...points].sort((left, right) => left.ts - right.ts);
  if (sortedPoints.length <= maximumPoints) {
    return sortedPoints;
  }

  return Array.from({ length: maximumPoints }, (_, bucketIndex) => {
    const startIndex = Math.floor((bucketIndex * sortedPoints.length) / maximumPoints);
    const endIndex = Math.floor(((bucketIndex + 1) * sortedPoints.length) / maximumPoints);
    const bucket = sortedPoints.slice(startIndex, endIndex);
    const averages = bucket.reduce(
      (sum, point) => ({
        ts: sum.ts + point.ts,
        p95: sum.p95 + point.p95,
        errRate: sum.errRate + point.errRate,
        rps: sum.rps + point.rps,
      }),
      { ts: 0, p95: 0, errRate: 0, rps: 0 },
    );
    const pointCount = bucket.length;

    return {
      ts: Math.round(averages.ts / pointCount),
      p95: averages.p95 / pointCount,
      errRate: averages.errRate / pointCount,
      rps: averages.rps / pointCount,
    };
  });
}
