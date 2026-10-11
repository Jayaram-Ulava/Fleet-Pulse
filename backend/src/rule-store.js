import { randomUUID } from 'node:crypto';

const METRIC_LIMITS = {
  p95: { minimum: 0, maximum: 60_000 },
  errRate: { minimum: 0, maximum: 100 },
  rps: { minimum: 0, maximum: 1_000_000 },
};
const CONDITION_OPERATORS = new Set(['>', '>=', '<', '<=']);
const MAX_RULE_CONDITIONS = 10;

export function validateRulePayload(value) {
  if (
    !isRecord(value) ||
    typeof value.name !== 'string' ||
    value.name.trim().length < 3 ||
    value.name.trim().length > 80 ||
    !Array.isArray(value.conditions) ||
    value.conditions.length < 1 ||
    value.conditions.length > MAX_RULE_CONDITIONS
  ) {
    return false;
  }

  return value.conditions.every((condition) => {
    if (!isRecord(condition)) {
      return false;
    }

    const limits = METRIC_LIMITS[condition.metric];
    return (
      limits !== undefined &&
      CONDITION_OPERATORS.has(condition.operator) &&
      typeof condition.threshold === 'number' &&
      Number.isFinite(condition.threshold) &&
      condition.threshold >= limits.minimum &&
      condition.threshold <= limits.maximum &&
      Number.isSafeInteger(condition.durationSeconds) &&
      condition.durationSeconds >= 1 &&
      condition.durationSeconds <= 86_400
    );
  });
}

export function createRuleStore() {
  const rules = new Map();
  const idempotencyKeys = new Map();

  return {
    list() {
      return [...rules.values()].map(clone);
    },
    get(ruleId) {
      const rule = rules.get(ruleId);
      return rule ? clone(rule) : null;
    },
    nameExists(name, excludeId = null) {
      const normalizedName = name.trim().toLocaleLowerCase();
      return [...rules.values()].some(
        (rule) => rule.id !== excludeId && rule.name.toLocaleLowerCase() === normalizedName,
      );
    },
    checkIdempotencyKey(idempotencyKey, payload) {
      const previous = idempotencyKeys.get(idempotencyKey);
      if (!previous) {
        return null;
      }

      if (JSON.stringify(previous.payload) !== JSON.stringify(payload)) {
        return { conflict: true, replayed: false, rule: null };
      }

      return { conflict: false, replayed: true, rule: clone(previous.rule) };
    },
    create(payload, idempotencyKey) {
      const replay = this.checkIdempotencyKey(idempotencyKey, payload);
      if (replay) {
        return replay;
      }

      const timestamp = new Date().toISOString();
      const rule = {
        id: randomUUID(),
        name: payload.name.trim(),
        conditions: payload.conditions.map((condition) => ({ ...condition })),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      rules.set(rule.id, rule);
      idempotencyKeys.set(idempotencyKey, { payload: clone(payload), rule });
      return { conflict: false, replayed: false, rule: clone(rule) };
    },
    update(ruleId, payload) {
      const existing = rules.get(ruleId);
      if (!existing) {
        return null;
      }

      const updated = {
        ...existing,
        name: payload.name.trim(),
        conditions: payload.conditions.map((condition) => ({ ...condition })),
        updatedAt: new Date().toISOString(),
      };
      rules.set(ruleId, updated);
      return clone(updated);
    },
    delete(ruleId) {
      return rules.delete(ruleId);
    },
  };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
