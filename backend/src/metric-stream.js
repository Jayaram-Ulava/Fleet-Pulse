const DEFAULT_HISTORY_LIMIT = 10_000;

export function createMetricStream(
  fleetData,
  { historyLimit = DEFAULT_HISTORY_LIMIT, now = Date.now } = {},
) {
  const metricByService = new Map(
    fleetData.snapshot().services.map((metric) => [metric.serviceId, metric]),
  );
  const serviceIds = [...metricByService.keys()];
  const history = [];
  const listeners = new Set();
  let offset = 0;
  let nextServiceIndex = 0;
  let timer = null;

  function generateOne() {
    const serviceId = serviceIds[nextServiceIndex];
    nextServiceIndex = (nextServiceIndex + 1) % serviceIds.length;
    const previous = metricByService.get(serviceId);
    const sequence = (previous?.seq ?? 0) + 1;
    const variation = ((offset * 17) % 31) - 15;
    const p95 = Math.max(10, (previous?.p95 ?? 100) + variation);
    const errRate = Math.max(
      0,
      Math.min(100, Number(((previous?.errRate ?? 0) + (offset % 5) * 0.01).toFixed(2))),
    );
    const rps = Math.max(0, (previous?.rps ?? 0) + ((offset % 9) - 4));
    const event = {
      type: 'metric',
      offset: ++offset,
      serviceId,
      seq: sequence,
      ts: now(),
      p95,
      errRate,
      rps,
      status: statusFor(p95, errRate),
    };

    metricByService.set(serviceId, event);
    history.push(event);
    if (history.length > historyLimit) {
      history.shift();
    }
    for (const listener of listeners) {
      listener(event);
    }

    return event;
  }

  return {
    generateOne,
    snapshot() {
      return { offset, services: [...metricByService.values()] };
    },
    historyForService(serviceId, minutes = 15) {
      const current = metricByService.get(serviceId);
      if (!current) {
        return null;
      }

      const pointCount = Math.min(300, minutes * 4);
      const durationMs = minutes * 60_000;
      const generatedAt = now();
      const points = Array.from({ length: pointCount }, (_, index) => {
        const phase = index / pointCount;
        const variation = Math.sin(index * 0.42 + serviceIds.indexOf(serviceId)) * 0.18;
        return {
          ts: generatedAt - durationMs + Math.round(phase * durationMs),
          p95: Math.max(0, Math.round(current.p95 * (1 + variation))),
          errRate: Math.max(0, Number((current.errRate * (1 + variation * 0.5)).toFixed(2))),
          rps: Math.max(0, Math.round(current.rps * (1 - variation))),
        };
      });

      return { serviceId, minutes, points };
    },
    replay(sinceOffset) {
      const oldestOffset = history[0]?.offset ?? offset + 1;
      if (sinceOffset < oldestOffset - 1) {
        return null;
      }

      return history.filter((event) => event.offset > sinceOffset);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start({ intervalMs = 100, eventsPerInterval = 10 } = {}) {
      if (timer) {
        return;
      }

      timer = setInterval(() => {
        for (let index = 0; index < eventsPerInterval; index += 1) {
          generateOne();
        }
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

function statusFor(p95, errRate) {
  if (p95 >= 700 || errRate >= 5) {
    return 'down';
  }

  if (p95 >= 450 || errRate >= 1) {
    return 'degraded';
  }

  return 'healthy';
}
