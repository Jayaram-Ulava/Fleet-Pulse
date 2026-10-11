const SERVICE_COUNT = 2_000;
const TEAM_NAMES = [
  'Payments',
  'Identity',
  'Commerce',
  'Platform',
  'Search',
  'Fulfillment',
  'Observability',
  'Customer Apps',
];
const SERVICE_NAMES = [
  'checkout-api',
  'identity-gateway',
  'catalog-indexer',
  'order-router',
  'payment-ledger',
  'inventory-sync',
  'search-query',
  'notification-dispatch',
  'session-manager',
  'shipping-rates',
  'profile-store',
  'event-collector',
];

export function createFleetData(now = Date.now) {
  const services = Array.from({ length: SERVICE_COUNT }, (_, index) => {
    const ordinal = index + 1;
    const catalogName = SERVICE_NAMES[index % SERVICE_NAMES.length];
    const instanceNumber = Math.floor(index / SERVICE_NAMES.length) + 1;
    const serviceId = `svc-${String(ordinal).padStart(4, '0')}`;
    const service = {
      serviceId,
      name: `${catalogName}-${String(instanceNumber).padStart(3, '0')}`,
      team: TEAM_NAMES[index % TEAM_NAMES.length],
    };

    return {
      service,
      metric: {
        serviceId,
        seq: 1,
        ts: now(),
        p95: 35 + ((index * 37) % 680),
        errRate: Number((((index * 13) % 420) / 100).toFixed(2)),
        rps: 8 + ((index * 23) % 950),
        status: statusFor(index),
      },
    };
  });

  return {
    listServices() {
      return services.map(({ service }) => service);
    },
    snapshot() {
      return {
        offset: 0,
        services: services.map(({ metric }) => metric),
      };
    },
  };
}

function statusFor(index) {
  if (index % 37 === 0) {
    return 'down';
  }

  if (index % 9 === 0) {
    return 'degraded';
  }

  return 'healthy';
}
