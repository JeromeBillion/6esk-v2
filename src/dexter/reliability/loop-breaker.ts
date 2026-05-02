export type LoopBreakerMode = 'return_last_success' | 'error';

export interface LoopBreakerConfig {
  enabled: boolean;
  windowMs: number;
  minAttempts: number;
  noProgressThreshold: number;
  cooldownMs: number;
  maxEntries: number;
  mode: LoopBreakerMode;
}

export interface LoopBreakerInput {
  agent: string;
  intent: string;
  routeReason: string;
  requestedModel: string;
  promptText: string;
}

export interface LoopBreakerDecision {
  triggered: boolean;
  code: string | null;
  reason: string | null;
  fallbackResponse: string | null;
}

interface LoopRecord {
  lastSeenAt: number;
  repeatCount: number;
  consecutiveNoProgress: number;
  blockedUntil: number | null;
  lastOutcome: 'success' | 'error' | null;
  lastErrorType: string | null;
  lastResponseDigest: string | null;
  lastSuccessResponse: string | null;
}

const DEFAULT_CONFIG: LoopBreakerConfig = {
  enabled: true,
  windowMs: 90 * 1000,
  minAttempts: 3,
  noProgressThreshold: 2,
  cooldownMs: 45 * 1000,
  maxEntries: 1500,
  mode: 'return_last_success',
};

const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
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

export const buildLoopBreakerConfigFromEnv = (): LoopBreakerConfig => {
  const modeEnv = process.env.DEXTER_LOOP_BREAKER_MODE?.trim().toLowerCase();
  const mode: LoopBreakerMode = modeEnv === 'error' ? 'error' : 'return_last_success';

  return {
    enabled: parseBooleanEnv(process.env.DEXTER_LOOP_BREAKER_ENABLED, DEFAULT_CONFIG.enabled),
    windowMs: parsePositiveIntEnv(process.env.DEXTER_LOOP_BREAKER_WINDOW_MS, DEFAULT_CONFIG.windowMs),
    minAttempts: parsePositiveIntEnv(process.env.DEXTER_LOOP_BREAKER_MIN_ATTEMPTS, DEFAULT_CONFIG.minAttempts),
    noProgressThreshold: parsePositiveIntEnv(
      process.env.DEXTER_LOOP_BREAKER_NO_PROGRESS_THRESHOLD,
      DEFAULT_CONFIG.noProgressThreshold
    ),
    cooldownMs: parsePositiveIntEnv(process.env.DEXTER_LOOP_BREAKER_COOLDOWN_MS, DEFAULT_CONFIG.cooldownMs),
    maxEntries: parsePositiveIntEnv(process.env.DEXTER_LOOP_BREAKER_MAX_ENTRIES, DEFAULT_CONFIG.maxEntries),
    mode,
  };
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const compactText = (value: string, maxLength = 260): string => {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength);
};

const responseDigest = (value: string): string => {
  const normalized = compactText(value, 220);
  return `${normalized.length}:${normalized}`;
};

const buildKey = (input: LoopBreakerInput): string => {
  const prompt = compactText(input.promptText || '', 400);
  return `${compactText(input.agent, 40)}|${compactText(input.intent, 30)}|${compactText(
    input.routeReason,
    50
  )}|${compactText(input.requestedModel, 40)}|${prompt}`;
};

export class LoopBreaker {
  private readonly config: LoopBreakerConfig;
  private readonly records = new Map<string, LoopRecord>();

  constructor(config: LoopBreakerConfig) {
    this.config = config;
  }

  getConfig(): LoopBreakerConfig {
    return this.config;
  }

  private prune(now: number): void {
    const cutoff = now - this.config.windowMs * 2;
    for (const [key, value] of this.records.entries()) {
      const recentlySeen = value.lastSeenAt >= cutoff;
      const blocked = !!(value.blockedUntil && value.blockedUntil > now);
      if (!recentlySeen && !blocked) {
        this.records.delete(key);
      }
    }

    if (this.records.size <= this.config.maxEntries) return;
    const sorted = Array.from(this.records.entries()).sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    for (const [key] of sorted) {
      if (this.records.size <= this.config.maxEntries) break;
      this.records.delete(key);
    }
  }

  beforeAttempt(input: LoopBreakerInput, now = Date.now()): { key: string; decision: LoopBreakerDecision } {
    if (!this.config.enabled) {
      return {
        key: buildKey(input),
        decision: { triggered: false, code: null, reason: null, fallbackResponse: null },
      };
    }

    this.prune(now);
    const key = buildKey(input);
    const existing = this.records.get(key);

    const record: LoopRecord =
      existing ??
      ({
        lastSeenAt: now,
        repeatCount: 0,
        consecutiveNoProgress: 0,
        blockedUntil: null,
        lastOutcome: null,
        lastErrorType: null,
        lastResponseDigest: null,
        lastSuccessResponse: null,
      } as LoopRecord);

    if (now - record.lastSeenAt <= this.config.windowMs) {
      record.repeatCount += 1;
    } else {
      record.repeatCount = 1;
      record.consecutiveNoProgress = 0;
    }
    record.lastSeenAt = now;

    const currentlyBlocked = !!(record.blockedUntil && record.blockedUntil > now);
    const shouldBlock =
      currentlyBlocked ||
      (record.repeatCount >= this.config.minAttempts &&
        record.consecutiveNoProgress >= this.config.noProgressThreshold);

    if (shouldBlock) {
      if (!currentlyBlocked) {
        record.blockedUntil = now + this.config.cooldownMs;
      }
      this.records.set(key, record);
      return {
        key,
        decision: {
          triggered: true,
          code: 'DEXTER_LOOP_BREAKER_TRIGGERED',
          reason: currentlyBlocked ? 'cooldown_active' : 'no_progress_detected',
          fallbackResponse:
            this.config.mode === 'return_last_success' ? record.lastSuccessResponse : null,
        },
      };
    }

    this.records.set(key, record);
    return {
      key,
      decision: { triggered: false, code: null, reason: null, fallbackResponse: null },
    };
  }

  registerSuccess(key: string, responseText: string | null): void {
    if (!this.config.enabled) return;
    const now = Date.now();
    const record = this.records.get(key);
    if (!record) return;

    const nextDigest = responseText ? responseDigest(responseText) : null;
    if (record.lastOutcome === 'success' && nextDigest && record.lastResponseDigest === nextDigest) {
      record.consecutiveNoProgress += 1;
    } else {
      record.consecutiveNoProgress = 0;
    }

    record.lastOutcome = 'success';
    record.lastErrorType = null;
    record.lastResponseDigest = nextDigest;
    record.lastSuccessResponse = responseText ?? record.lastSuccessResponse;
    record.lastSeenAt = now;
    this.records.set(key, record);
  }

  registerError(key: string, errorType: string): void {
    if (!this.config.enabled) return;
    const now = Date.now();
    const record = this.records.get(key);
    if (!record) return;

    if (record.lastOutcome === 'error' && record.lastErrorType === errorType) {
      record.consecutiveNoProgress += 1;
    } else {
      record.consecutiveNoProgress = 1;
    }
    record.lastOutcome = 'error';
    record.lastErrorType = errorType;
    record.lastSeenAt = now;
    this.records.set(key, record);
  }
}

