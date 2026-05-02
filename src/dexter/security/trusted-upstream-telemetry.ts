type RiskLevel = 'low' | 'high';

export interface TrustedTelemetryHint {
  source: string;
  timestampMs: number;
  intent: string;
  risk?: RiskLevel;
}

export interface TrustedTelemetryConfig {
  enabled: boolean;
  allowSources: string[];
  ttlMs: number;
  maxFutureSkewMs: number;
}

export interface TrustedTelemetryValidationResult {
  trusted: boolean;
  hint: TrustedTelemetryHint | null;
  reason:
    | 'disabled'
    | 'missing'
    | 'invalid_schema'
    | 'source_not_allowed'
    | 'stale'
    | 'future_timestamp'
    | 'ok';
}

const DEFAULT_TTL_MS = 120_000;
const DEFAULT_MAX_FUTURE_SKEW_MS = 15_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const parseBooleanEnv = (value: string | undefined, fallback = false): boolean => {
  if (!value?.trim()) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const parsePositiveIntEnv = (value: string | undefined, fallback: number): number => {
  if (!value?.trim()) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const normalizeList = (raw: string | undefined): string[] =>
  (raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());

const parseTimestampMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const readRisk = (value: unknown): RiskLevel | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'low' || normalized === 'high') return normalized;
  return undefined;
};

export const buildTrustedTelemetryConfigFromEnv = (): TrustedTelemetryConfig => ({
  enabled: parseBooleanEnv(process.env.DEXTER_TRUSTED_TELEMETRY_ENABLED, false),
  allowSources: normalizeList(process.env.DEXTER_TRUSTED_TELEMETRY_SOURCES),
  ttlMs: parsePositiveIntEnv(process.env.DEXTER_TRUSTED_TELEMETRY_TTL_MS, DEFAULT_TTL_MS),
  maxFutureSkewMs: parsePositiveIntEnv(
    process.env.DEXTER_TRUSTED_TELEMETRY_MAX_FUTURE_SKEW_MS,
    DEFAULT_MAX_FUTURE_SKEW_MS
  ),
});

const readNestedObject = (root: Record<string, unknown>, key: string): Record<string, unknown> | null => {
  const value = root[key];
  return isRecord(value) ? value : null;
};

export const extractTrustedTelemetryCandidate = (
  params: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  if (!params || !isRecord(params)) return null;

  const direct =
    readNestedObject(params, 'upstreamTelemetry') || readNestedObject(params, 'routingTelemetry');
  if (direct) return direct;

  const metadata = readNestedObject(params, 'metadata');
  if (metadata) {
    const fromMetadata =
      readNestedObject(metadata, 'upstreamTelemetry') || readNestedObject(metadata, 'routingTelemetry');
    if (fromMetadata) return fromMetadata;
  }

  const context = readNestedObject(params, 'context');
  if (context) {
    const fromContext =
      readNestedObject(context, 'upstreamTelemetry') || readNestedObject(context, 'routingTelemetry');
    if (fromContext) return fromContext;
  }

  return null;
};

export const validateTrustedTelemetryCandidate = (
  candidate: Record<string, unknown> | null,
  config: TrustedTelemetryConfig,
  now = Date.now()
): TrustedTelemetryValidationResult => {
  if (!config.enabled) {
    return { trusted: false, hint: null, reason: 'disabled' };
  }

  if (!candidate) {
    return { trusted: false, hint: null, reason: 'missing' };
  }

  const source = typeof candidate.source === 'string' ? candidate.source.trim().toLowerCase() : '';
  const intent = typeof candidate.intent === 'string' ? candidate.intent.trim().toLowerCase() : '';
  const timestampMs = parseTimestampMs(candidate.timestamp ?? candidate.timestampMs);
  const risk = readRisk(candidate.risk);

  if (!source || !intent || timestampMs === null) {
    return { trusted: false, hint: null, reason: 'invalid_schema' };
  }

  if (!config.allowSources.includes(source)) {
    return { trusted: false, hint: null, reason: 'source_not_allowed' };
  }

  if (timestampMs > now + config.maxFutureSkewMs) {
    return { trusted: false, hint: null, reason: 'future_timestamp' };
  }

  if (now - timestampMs > config.ttlMs) {
    return { trusted: false, hint: null, reason: 'stale' };
  }

  return {
    trusted: true,
    hint: {
      source,
      timestampMs,
      intent,
      risk,
    },
    reason: 'ok',
  };
};

