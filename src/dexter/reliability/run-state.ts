import { ModelType } from '@elizaos/core';

export type DexterRunState = 'active' | 'cooldown' | 'paused' | 'halted';

export interface RunStateConfig {
  enabled: boolean;
  errorWindowMs: number;
  cooldownConsecutiveErrors: number;
  cooldownDurationMs: number;
  pauseWindowErrors: number;
  pauseDurationMs: number;
  haltWindowErrors: number;
  haltDurationMs: number;
  hardHalt: boolean;
  cooldownMaxTokens: number;
  pauseMaxTokens: number;
  haltMaxTokens: number;
}

export interface RunStateDecision {
  state: DexterRunState;
  forceModel: typeof ModelType.TEXT_SMALL | null;
  maxTokensCap: number | null;
  bypass: boolean;
  reason: string | null;
}

export interface RunStateSnapshot {
  state: DexterRunState;
  stateUntil: number | null;
  consecutiveErrors: number;
  errorsInWindow: number;
}

const DEFAULT_CONFIG: RunStateConfig = {
  enabled: true,
  errorWindowMs: 2 * 60 * 1000,
  cooldownConsecutiveErrors: 4,
  cooldownDurationMs: 60 * 1000,
  pauseWindowErrors: 8,
  pauseDurationMs: 60 * 1000,
  haltWindowErrors: 14,
  haltDurationMs: 90 * 1000,
  hardHalt: false,
  cooldownMaxTokens: 180,
  pauseMaxTokens: 120,
  haltMaxTokens: 96,
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

export const buildRunStateConfigFromEnv = (): RunStateConfig => ({
  enabled: parseBooleanEnv(process.env.DEXTER_RUNSTATE_ENABLED, DEFAULT_CONFIG.enabled),
  errorWindowMs: parsePositiveIntEnv(process.env.DEXTER_RUNSTATE_ERROR_WINDOW_MS, DEFAULT_CONFIG.errorWindowMs),
  cooldownConsecutiveErrors: parsePositiveIntEnv(
    process.env.DEXTER_RUNSTATE_COOLDOWN_CONSECUTIVE_ERRORS,
    DEFAULT_CONFIG.cooldownConsecutiveErrors
  ),
  cooldownDurationMs: parsePositiveIntEnv(
    process.env.DEXTER_RUNSTATE_COOLDOWN_DURATION_MS,
    DEFAULT_CONFIG.cooldownDurationMs
  ),
  pauseWindowErrors: parsePositiveIntEnv(process.env.DEXTER_RUNSTATE_PAUSE_WINDOW_ERRORS, DEFAULT_CONFIG.pauseWindowErrors),
  pauseDurationMs: parsePositiveIntEnv(process.env.DEXTER_RUNSTATE_PAUSE_DURATION_MS, DEFAULT_CONFIG.pauseDurationMs),
  haltWindowErrors: parsePositiveIntEnv(process.env.DEXTER_RUNSTATE_HALT_WINDOW_ERRORS, DEFAULT_CONFIG.haltWindowErrors),
  haltDurationMs: parsePositiveIntEnv(process.env.DEXTER_RUNSTATE_HALT_DURATION_MS, DEFAULT_CONFIG.haltDurationMs),
  hardHalt: parseBooleanEnv(process.env.DEXTER_RUNSTATE_HARD_HALT, DEFAULT_CONFIG.hardHalt),
  cooldownMaxTokens: parsePositiveIntEnv(process.env.DEXTER_RUNSTATE_COOLDOWN_MAX_TOKENS, DEFAULT_CONFIG.cooldownMaxTokens),
  pauseMaxTokens: parsePositiveIntEnv(process.env.DEXTER_RUNSTATE_PAUSE_MAX_TOKENS, DEFAULT_CONFIG.pauseMaxTokens),
  haltMaxTokens: parsePositiveIntEnv(process.env.DEXTER_RUNSTATE_HALT_MAX_TOKENS, DEFAULT_CONFIG.haltMaxTokens),
});

export class RunStateController {
  private readonly config: RunStateConfig;
  private state: DexterRunState = 'active';
  private stateUntil: number | null = null;
  private consecutiveErrors = 0;
  private errorTimestamps: number[] = [];

  constructor(config: RunStateConfig) {
    this.config = config;
  }

  getConfig(): RunStateConfig {
    return this.config;
  }

  private trimErrorWindow(now: number): void {
    const cutoff = now - this.config.errorWindowMs;
    this.errorTimestamps = this.errorTimestamps.filter((ts) => ts >= cutoff);
  }

  private refreshState(now: number): void {
    if (this.state !== 'active' && this.stateUntil !== null && now >= this.stateUntil) {
      this.state = 'active';
      this.stateUntil = null;
    }
  }

  private transition(nextState: DexterRunState, durationMs: number, now: number): boolean {
    if (this.state === nextState && this.stateUntil && this.stateUntil > now) {
      return false;
    }
    this.state = nextState;
    this.stateUntil = now + durationMs;
    return true;
  }

  getSnapshot(now = Date.now()): RunStateSnapshot {
    this.refreshState(now);
    this.trimErrorWindow(now);
    return {
      state: this.state,
      stateUntil: this.stateUntil,
      consecutiveErrors: this.consecutiveErrors,
      errorsInWindow: this.errorTimestamps.length,
    };
  }

  beforeModelCall(_requestedModel: string, now = Date.now()): RunStateDecision {
    if (!this.config.enabled) {
      return {
        state: 'active',
        forceModel: null,
        maxTokensCap: null,
        bypass: false,
        reason: null,
      };
    }

    this.refreshState(now);
    switch (this.state) {
      case 'cooldown':
        return {
          state: this.state,
          forceModel: ModelType.TEXT_SMALL,
          maxTokensCap: this.config.cooldownMaxTokens,
          bypass: false,
          reason: 'cooldown',
        };
      case 'paused':
        return {
          state: this.state,
          forceModel: ModelType.TEXT_SMALL,
          maxTokensCap: this.config.pauseMaxTokens,
          bypass: false,
          reason: 'paused',
        };
      case 'halted':
        return {
          state: this.state,
          forceModel: this.config.hardHalt ? null : ModelType.TEXT_SMALL,
          maxTokensCap: this.config.hardHalt ? null : this.config.haltMaxTokens,
          bypass: this.config.hardHalt,
          reason: this.config.hardHalt ? 'halted_hard' : 'halted_soft',
        };
      default:
        return {
          state: 'active',
          forceModel: null,
          maxTokensCap: null,
          bypass: false,
          reason: null,
        };
    }
  }

  registerSuccess(now = Date.now()): void {
    this.refreshState(now);
    this.consecutiveErrors = 0;
  }

  registerError(now = Date.now()): { changed: boolean; previous: DexterRunState; current: DexterRunState } {
    if (!this.config.enabled) {
      return { changed: false, previous: this.state, current: this.state };
    }

    const previous = this.state;
    this.refreshState(now);
    this.consecutiveErrors += 1;
    this.errorTimestamps.push(now);
    this.trimErrorWindow(now);

    const windowCount = this.errorTimestamps.length;
    if (windowCount >= this.config.haltWindowErrors) {
      this.transition('halted', this.config.haltDurationMs, now);
    } else if (windowCount >= this.config.pauseWindowErrors) {
      this.transition('paused', this.config.pauseDurationMs, now);
    } else if (this.consecutiveErrors >= this.config.cooldownConsecutiveErrors) {
      this.transition('cooldown', this.config.cooldownDurationMs, now);
    }

    return { changed: this.state !== previous, previous, current: this.state };
  }
}

