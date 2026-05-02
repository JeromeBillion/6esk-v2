import { redactSensitiveLogContext } from './utils/redaction';

type GateSeverity = 'warning' | 'error';

interface StartupGateIssue {
  severity: GateSeverity;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

interface StartupGateResult {
  issues: StartupGateIssue[];
  warningCount: number;
  errorCount: number;
}

const parseBooleanEnv = (value: string | undefined, fallback = false): boolean => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value?.trim()) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const hasAllEnv = (keys: string[]): boolean =>
  keys.every((key) => typeof process.env[key] === 'string' && process.env[key]!.trim().length > 0);

const missingEnv = (keys: string[]): string[] =>
  keys.filter((key) => !(typeof process.env[key] === 'string' && process.env[key]!.trim().length > 0));

const addIssue = (
  issues: StartupGateIssue[],
  severity: GateSeverity,
  code: string,
  message: string,
  details?: Record<string, unknown>
): void => {
  issues.push({ severity, code, message, details });
};

const lintNumericSettings = (issues: StartupGateIssue[]): void => {
  const numericFields = [
    { key: 'CRM_LOW_RISK_MAX_TOKENS', min: 64, max: 4096 },
    { key: 'ROUTING_CACHE_MAX_ENTRIES', min: 1, max: 50000 },
    { key: 'DEGRADE_MAX_TOKENS', min: 64, max: 8192 },
    { key: 'SIXESK_CALL_SUMMARY_MAX_TOKENS', min: 64, max: 4096 },
    { key: 'SIXESK_CALL_SUMMARY_MAX_CHARS', min: 200, max: 100000 },
    { key: 'DEXTER_RUNSTATE_ERROR_WINDOW_MS', min: 10000, max: 1800000 },
    { key: 'DEXTER_RUNSTATE_COOLDOWN_CONSECUTIVE_ERRORS', min: 1, max: 100 },
    { key: 'DEXTER_RUNSTATE_COOLDOWN_DURATION_MS', min: 1000, max: 1800000 },
    { key: 'DEXTER_RUNSTATE_PAUSE_WINDOW_ERRORS', min: 1, max: 200 },
    { key: 'DEXTER_RUNSTATE_PAUSE_DURATION_MS', min: 1000, max: 1800000 },
    { key: 'DEXTER_RUNSTATE_HALT_WINDOW_ERRORS', min: 1, max: 500 },
    { key: 'DEXTER_RUNSTATE_HALT_DURATION_MS', min: 1000, max: 3600000 },
    { key: 'DEXTER_RUNSTATE_COOLDOWN_MAX_TOKENS', min: 32, max: 2048 },
    { key: 'DEXTER_RUNSTATE_PAUSE_MAX_TOKENS', min: 32, max: 1024 },
    { key: 'DEXTER_RUNSTATE_HALT_MAX_TOKENS', min: 16, max: 512 },
    { key: 'DEXTER_LOOP_BREAKER_WINDOW_MS', min: 10000, max: 1800000 },
    { key: 'DEXTER_LOOP_BREAKER_MIN_ATTEMPTS', min: 2, max: 50 },
    { key: 'DEXTER_LOOP_BREAKER_NO_PROGRESS_THRESHOLD', min: 1, max: 30 },
    { key: 'DEXTER_LOOP_BREAKER_COOLDOWN_MS', min: 1000, max: 1800000 },
    { key: 'DEXTER_LOOP_BREAKER_MAX_ENTRIES', min: 10, max: 50000 },
    { key: 'DEXTER_TRUSTED_TELEMETRY_TTL_MS', min: 1000, max: 1800000 },
    { key: 'DEXTER_TRUSTED_TELEMETRY_MAX_FUTURE_SKEW_MS', min: 100, max: 300000 },
  ];

  for (const field of numericFields) {
    const raw = process.env[field.key];
    if (!raw?.trim()) continue;
    const parsed = parsePositiveInt(raw);
    if (parsed === null || parsed < field.min || parsed > field.max) {
      addIssue(
        issues,
        'warning',
        'DEXTER_STARTUP_NUMERIC_LINT',
        `${field.key} is outside recommended range`,
        { key: field.key, raw, min: field.min, max: field.max }
      );
    }
  }
};

const runReadinessChecks = (): StartupGateResult => {
  const issues: StartupGateIssue[] = [];

  const crmEnabled = parseBooleanEnv(process.env.DEXTER_ENABLE_CRM_AGENT, false);
  const waEnabled = parseBooleanEnv(process.env.DEXTER_ENABLE_WHATSAPP_AGENT, false);
  const twitterEnabled = parseBooleanEnv(process.env.DEXTER_ENABLE_TWITTER_AGENT, false);
  const voiceBridgeEnabled = parseBooleanEnv(process.env.VOICE_BRIDGE_ENABLED, false);
  const routeAuthEnabled = parseBooleanEnv(process.env.DEXTER_ROUTE_AUTH_ENABLED, false);
  const trustedTelemetryEnabled = parseBooleanEnv(
    process.env.DEXTER_TRUSTED_TELEMETRY_ENABLED,
    false
  );

  if (crmEnabled) {
    const required = ['SIXESK_BASE_URL', 'SIXESK_AGENT_KEY', 'SIXESK_SHARED_SECRET'];
    const missing = missingEnv(required);
    if (missing.length) {
      addIssue(
        issues,
        'error',
        'DEXTER_STARTUP_CRM_CREDENTIALS_MISSING',
        'CRM agent is enabled but required 6esk credentials are missing',
        { missing }
      );
    }
  }

  if (waEnabled) {
    const required = [
      'WHATSAPP_PHONE_NUMBER_ID',
      'WHATSAPP_ACCESS_TOKEN',
      'WHATSAPP_VERIFY_TOKEN',
      'WHATSAPP_APP_SECRET',
    ];
    const missing = missingEnv(required);
    if (missing.length) {
      addIssue(
        issues,
        'error',
        'DEXTER_STARTUP_WHATSAPP_CREDENTIALS_MISSING',
        'WhatsApp agent is enabled but required credentials are missing',
        { missing }
      );
    }
  }

  if (twitterEnabled) {
    const hasOauth = hasAllEnv(['TWITTER_CLIENT_ID', 'TWITTER_REDIRECT_URI']);
    const hasEnvAuth = hasAllEnv([
      'TWITTER_API_KEY',
      'TWITTER_API_SECRET_KEY',
      'TWITTER_ACCESS_TOKEN',
      'TWITTER_ACCESS_TOKEN_SECRET',
    ]);
    if (!hasOauth && !hasEnvAuth) {
      addIssue(
        issues,
        'error',
        'DEXTER_STARTUP_TWITTER_CREDENTIALS_MISSING',
        'Twitter agent is enabled but no valid auth credential set was found',
        {
          required_env_auth: [
            'TWITTER_API_KEY',
            'TWITTER_API_SECRET_KEY',
            'TWITTER_ACCESS_TOKEN',
            'TWITTER_ACCESS_TOKEN_SECRET',
          ],
          required_oauth: ['TWITTER_CLIENT_ID', 'TWITTER_REDIRECT_URI'],
        }
      );
    }
  }

  if (voiceBridgeEnabled) {
    const required = ['DEXTER_SERVICE_URL', 'DEXTER_AGENT_ID', 'ELIZA_SERVER_AUTH_TOKEN'];
    const missing = missingEnv(required);
    if (missing.length) {
      addIssue(
        issues,
        'error',
        'DEXTER_STARTUP_VOICE_BRIDGE_MISSING_PROXY_ENV',
        'Voice bridge is enabled but required proxy/auth environment values are missing',
        { missing }
      );
    }
  }

  if (routeAuthEnabled) {
    const readToken =
      process.env.DEXTER_ROUTE_READ_TOKEN?.trim() ||
      process.env.DEXTER_ROUTE_EXECUTE_TOKEN?.trim() ||
      process.env.ELIZA_SERVER_AUTH_TOKEN?.trim() ||
      null;
    const executeToken =
      process.env.DEXTER_ROUTE_EXECUTE_TOKEN?.trim() || process.env.ELIZA_SERVER_AUTH_TOKEN?.trim() || null;

    if (!readToken) {
      addIssue(
        issues,
        'error',
        'DEXTER_STARTUP_ROUTE_READ_TOKEN_MISSING',
        'Route auth is enabled but no read scope auth token is configured',
        {
          expectedOneOf: ['DEXTER_ROUTE_READ_TOKEN', 'DEXTER_ROUTE_EXECUTE_TOKEN', 'ELIZA_SERVER_AUTH_TOKEN'],
        }
      );
    }

    if (!executeToken) {
      addIssue(
        issues,
        'error',
        'DEXTER_STARTUP_ROUTE_EXECUTE_TOKEN_MISSING',
        'Route auth is enabled but no execute scope auth token is configured',
        {
          expectedOneOf: ['DEXTER_ROUTE_EXECUTE_TOKEN', 'ELIZA_SERVER_AUTH_TOKEN'],
        }
      );
    }
  }

  if (trustedTelemetryEnabled) {
    const allowSources = (process.env.DEXTER_TRUSTED_TELEMETRY_SOURCES || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (!allowSources.length) {
      addIssue(
        issues,
        'warning',
        'DEXTER_STARTUP_TRUSTED_TELEMETRY_NO_SOURCES',
        'Trusted telemetry is enabled but no allowed sources are configured; all upstream hints will be rejected',
        { expected: 'DEXTER_TRUSTED_TELEMETRY_SOURCES=source_a,source_b' }
      );
    }
  }

  lintNumericSettings(issues);

  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  return { issues, warningCount, errorCount };
};

export const runDexterStartupGates = (): void => {
  const strict = parseBooleanEnv(process.env.DEXTER_STARTUP_STRICT, false);
  const failOnWarning = parseBooleanEnv(process.env.DEXTER_STARTUP_FAIL_ON_WARNING, false);
  const result = runReadinessChecks();

  if (result.issues.length > 0) {
    const safeIssues = redactSensitiveLogContext(result.issues);
    console.warn(
      `[Dexter][startup-gates] warnings=${result.warningCount} errors=${result.errorCount}\n${JSON.stringify(
        safeIssues,
        null,
        2
      )}`
    );
  }

  const shouldFail =
    result.errorCount > 0 || (strict && result.warningCount > 0) || (failOnWarning && result.warningCount > 0);
  if (shouldFail) {
    throw new Error(
      `[Dexter] Startup gates failed: warnings=${result.warningCount}, errors=${result.errorCount}`
    );
  }
};
