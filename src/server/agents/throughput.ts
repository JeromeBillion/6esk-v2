const DEFAULT_DELIVERY_LIMIT = 5;
const MIN_DELIVERY_LIMIT = 1;
const MAX_DELIVERY_LIMIT = 50;

function normalizeLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.trunc(parsed);
  if (rounded < MIN_DELIVERY_LIMIT) return null;
  return Math.min(rounded, MAX_DELIVERY_LIMIT);
}

export function parseMaxEventsPerRun(capabilities?: Record<string, unknown> | null) {
  if (!capabilities || typeof capabilities !== "object") {
    return null;
  }

  const explicit = normalizeLimit(capabilities.max_events_per_run);
  if (explicit) {
    return explicit;
  }

  return normalizeLimit(capabilities.maxEventsPerRun);
}

export function resolveDeliveryLimit({
  requestedLimit,
  capabilities
}: {
  requestedLimit?: number | null;
  capabilities?: Record<string, unknown> | null;
}) {
  const requested = normalizeLimit(requestedLimit);
  const base = requested ?? DEFAULT_DELIVERY_LIMIT;
  const maxPerRun = parseMaxEventsPerRun(capabilities);
  if (!maxPerRun) {
    return base;
  }
  return Math.min(base, maxPerRun);
}
