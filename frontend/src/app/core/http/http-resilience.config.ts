export const HTTP_RESILIENCE = {
  timeoutMs: 10_000,
  maxAttempts: 3,
  baseRetryDelayMs: 250,
  maxRetryDelayMs: 4_000,
} as const;

export const RETRYABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);
