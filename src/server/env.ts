import { z } from "zod";

const nonEmptyString = z.string().min(1);
const optionalUrl = z.union([z.string().url(), z.literal("")]).optional();
const optionalNonEmptyString = z.string().optional();
const optionalSecretString = z.union([z.string().min(16), z.literal("")]).optional();
const optionalBooleanish = z.string().optional();

const envSchema = z.object({
  APP_URL: z.string().url(),
  DATABASE_URL: nonEmptyString,
  SESSION_SECRET: z.string().min(16),
  RESEND_API_KEY: nonEmptyString,
  RESEND_WEBHOOK_SECRET: nonEmptyString,
  RESEND_FROM_DOMAIN: nonEmptyString,
  SUPPORT_ADDRESS: optionalNonEmptyString,
  INBOUND_SHARED_SECRET: optionalNonEmptyString,
  AGENT_SECRET_KEY: optionalSecretString,
  ADMIN_IP_ALLOWLIST: z.string().optional(),
  AGENT_IP_ALLOWLIST: z.string().optional(),
  INBOUND_ALERT_WEBHOOK: z.union([z.string().url(), z.literal("")]).optional(),
  INBOUND_ALERT_THRESHOLD: z.string().optional(),
  INBOUND_ALERT_WINDOW_MINUTES: z.string().optional(),
  INBOUND_ALERT_COOLDOWN_MINUTES: z.string().optional(),
  R2_ENDPOINT: nonEmptyString,
  R2_ACCESS_KEY_ID: nonEmptyString,
  R2_SECRET_ACCESS_KEY: nonEmptyString,
  R2_BUCKET: nonEmptyString,

  CRON_SECRET: optionalNonEmptyString,
  WHATSAPP_VERIFY_TOKEN: optionalNonEmptyString,
  WHATSAPP_APP_SECRET: optionalNonEmptyString,
  WHATSAPP_OUTBOX_SECRET: optionalNonEmptyString,
  WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS: optionalBooleanish,

  AI_API_KEY: optionalNonEmptyString,
  OPENAI_API_KEY: optionalNonEmptyString,
  DEXTER_RUNTIME_ENABLED: optionalBooleanish,
  DEXTER_RUNTIME_ALPHA_ACK: optionalBooleanish,
  DEXTER_RUNTIME_MODE: optionalNonEmptyString,
  DEXTER_RUNTIME_HTTP_URL: optionalUrl,
  DEXTER_RUNTIME_HTTP_SECRET: optionalNonEmptyString,
  DEXTER_RUNTIME_HTTP_TIMEOUT_MS: optionalNonEmptyString,

  CALLS_PROVIDER: z.string().optional(),
  CALLS_PROVIDER_HTTP_URL: optionalUrl,
  CALLS_PROVIDER_HTTP_SECRET: optionalNonEmptyString,
  CALLS_TWILIO_ACCOUNT_SID: optionalNonEmptyString,
  CALLS_TWILIO_AUTH_TOKEN: optionalNonEmptyString,
  CALLS_TWILIO_API_KEY_SID: optionalNonEmptyString,
  CALLS_TWILIO_API_KEY_SECRET: optionalNonEmptyString,
  CALLS_TWILIO_FROM_NUMBER: optionalNonEmptyString,
  CALLS_WEBHOOK_SECRET: optionalNonEmptyString,
  CALLS_WEBHOOK_ALLOW_UNAUTHENTICATED: optionalBooleanish,
  CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE: optionalBooleanish,
  CALLS_OUTBOX_SECRET: optionalNonEmptyString,
  CALLS_STT_PROVIDER: z.string().optional(),
  CALLS_STT_PROVIDER_HTTP_URL: optionalUrl,
  CALLS_STT_PROVIDER_HTTP_SECRET: optionalNonEmptyString,
  CALLS_STT_DEEPGRAM_API_KEY: optionalNonEmptyString,
  CALLS_STT_DEEPGRAM_CALLBACK_TOKEN: optionalNonEmptyString,
  CALLS_TRANSCRIPT_AI_PROVIDER: z.string().optional(),
  CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_URL: optionalUrl,
  CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_SECRET: optionalNonEmptyString,
  CALLS_TRANSCRIPT_SHARED_SECRET: optionalNonEmptyString,

  // OAuth
  OAUTH_ENCRYPTION_KEY: z.union([z.string().regex(/^[a-f0-9]{64}$/i), z.literal("")]).optional(),
  GOOGLE_OAUTH_CLIENT_ID: optionalNonEmptyString,
  GOOGLE_OAUTH_CLIENT_SECRET: optionalNonEmptyString,
  GOOGLE_OAUTH_REDIRECT_URI: optionalUrl,
  GOOGLE_PUBSUB_TOPIC: optionalNonEmptyString,
  MICROSOFT_OAUTH_CLIENT_ID: optionalNonEmptyString,
  MICROSOFT_OAUTH_CLIENT_SECRET: optionalNonEmptyString,
  MICROSOFT_OAUTH_TENANT_ID: optionalNonEmptyString,
  MICROSOFT_OAUTH_REDIRECT_URI: optionalUrl,
  MICROSOFT_WEBHOOK_URL: optionalUrl,
  ZOHO_OAUTH_CLIENT_ID: optionalNonEmptyString,
  ZOHO_OAUTH_CLIENT_SECRET: optionalNonEmptyString,
  ZOHO_OAUTH_REDIRECT_URI: optionalUrl,

  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalNonEmptyString
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

type EnvSource = Record<string, string | undefined>;

export type ValidateEnvOptions = {
  strictProduction?: boolean;
};

function readString(source: EnvSource, key: string) {
  const value = source[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isEnabled(source: EnvSource, key: string) {
  const normalized = readString(source, key)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function requireKeys(source: EnvSource, keys: string[], issues: string[]) {
  for (const key of keys) {
    if (!readString(source, key)) {
      issues.push(key);
    }
  }
}

function requireOneOf(source: EnvSource, keys: string[], issues: string[], label = keys.join("|")) {
  if (!keys.some((key) => readString(source, key))) {
    issues.push(label);
  }
}

function requireCompleteGroup(source: EnvSource, keys: string[], issues: string[]) {
  const hasAny = keys.some((key) => readString(source, key));
  if (!hasAny) return;
  requireKeys(source, keys, issues);
}

function addProductionIssues(source: EnvSource, issues: string[]) {
  requireKeys(source, [
    "INBOUND_SHARED_SECRET",
    "AGENT_SECRET_KEY",
    "CRON_SECRET",
    "OAUTH_ENCRYPTION_KEY",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_OUTBOX_SECRET",
    "CALLS_WEBHOOK_SECRET",
    "CALLS_OUTBOX_SECRET"
  ], issues);

  requireOneOf(source, ["AI_API_KEY", "OPENAI_API_KEY"], issues, "AI_API_KEY|OPENAI_API_KEY");

  requireCompleteGroup(source, [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI"
  ], issues);
  requireCompleteGroup(source, [
    "MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_SECRET",
    "MICROSOFT_OAUTH_REDIRECT_URI"
  ], issues);
  requireCompleteGroup(source, [
    "ZOHO_OAUTH_CLIENT_ID",
    "ZOHO_OAUTH_CLIENT_SECRET",
    "ZOHO_OAUTH_REDIRECT_URI"
  ], issues);

  if (isEnabled(source, "WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS")) {
    issues.push("WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS must be false in production");
  }
  if (isEnabled(source, "CALLS_WEBHOOK_ALLOW_UNAUTHENTICATED")) {
    issues.push("CALLS_WEBHOOK_ALLOW_UNAUTHENTICATED must be false in production");
  }
  if (isEnabled(source, "CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE")) {
    issues.push("CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE must be false in production");
  }

  const callsProvider = readString(source, "CALLS_PROVIDER")?.toLowerCase() ?? "mock";
  if (callsProvider === "mock") {
    issues.push("CALLS_PROVIDER must not be mock in production");
  } else if (callsProvider === "twilio") {
    requireKeys(source, [
      "CALLS_TWILIO_ACCOUNT_SID",
      "CALLS_TWILIO_AUTH_TOKEN",
      "CALLS_TWILIO_API_KEY_SID",
      "CALLS_TWILIO_API_KEY_SECRET",
      "CALLS_TWILIO_FROM_NUMBER"
    ], issues);
  } else if (callsProvider === "http_bridge") {
    requireKeys(source, ["CALLS_PROVIDER_HTTP_URL", "CALLS_PROVIDER_HTTP_SECRET"], issues);
  } else {
    issues.push("CALLS_PROVIDER must be one of twilio or http_bridge in production");
  }

  const sttProvider = readString(source, "CALLS_STT_PROVIDER")?.toLowerCase() ?? "managed_http";
  if (sttProvider === "mock") {
    issues.push("CALLS_STT_PROVIDER must not be mock in production");
  } else if (sttProvider === "managed_http") {
    requireKeys(source, ["CALLS_STT_PROVIDER_HTTP_URL", "CALLS_STT_PROVIDER_HTTP_SECRET"], issues);
    const sttUrl = readString(source, "CALLS_STT_PROVIDER_HTTP_URL");
    if (!sttUrl || sttUrl.includes("/api/internal/calls/stt/deepgram")) {
      requireKeys(source, ["CALLS_STT_DEEPGRAM_API_KEY", "CALLS_STT_DEEPGRAM_CALLBACK_TOKEN"], issues);
    }
  } else {
    issues.push("CALLS_STT_PROVIDER must be managed_http in production");
  }

  const transcriptAiProvider =
    readString(source, "CALLS_TRANSCRIPT_AI_PROVIDER")?.toLowerCase() ?? "managed_http";
  if (transcriptAiProvider === "mock") {
    issues.push("CALLS_TRANSCRIPT_AI_PROVIDER must not be mock in production");
  } else if (transcriptAiProvider === "managed_http") {
    requireOneOf(
      source,
      ["CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_SECRET", "CALLS_STT_PROVIDER_HTTP_SECRET"],
      issues,
      "CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_SECRET|CALLS_STT_PROVIDER_HTTP_SECRET"
    );
  } else {
    issues.push("CALLS_TRANSCRIPT_AI_PROVIDER must be managed_http in production");
  }

  if (!readString(source, "UPSTASH_REDIS_REST_URL") || !readString(source, "UPSTASH_REDIS_REST_TOKEN")) {
    issues.push("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
  }

  if (isEnabled(source, "DEXTER_RUNTIME_ENABLED") && !isEnabled(source, "DEXTER_RUNTIME_ALPHA_ACK")) {
    issues.push("DEXTER_RUNTIME_ALPHA_ACK must be true when DEXTER_RUNTIME_ENABLED is true in production");
  }
  if (isEnabled(source, "DEXTER_RUNTIME_ENABLED")) {
    const runtimeMode = readString(source, "DEXTER_RUNTIME_MODE")?.toLowerCase() ?? "native";
    if (runtimeMode === "http_bridge" || runtimeMode === "http-bridge" || runtimeMode === "http") {
      requireKeys(source, ["DEXTER_RUNTIME_HTTP_URL"], issues);
      requireOneOf(
        source,
        ["DEXTER_RUNTIME_HTTP_SECRET", "SIXESK_SHARED_SECRET"],
        issues,
        "DEXTER_RUNTIME_HTTP_SECRET|SIXESK_SHARED_SECRET"
      );
    }
  }
}

function formatIssues(issues: string[]) {
  return Array.from(new Set(issues)).join(", ");
}

export function validateEnv(source: EnvSource = process.env, options: ValidateEnvOptions = {}) {
  const parsed = envSchema.safeParse(source);
  const issues: string[] = [];

  if (!parsed.success) {
    issues.push(...parsed.error.issues.map((issue) => issue.path.join(".")));
  }

  const strictProduction = options.strictProduction ?? source.NODE_ENV === "production";
  if (strictProduction) {
    addProductionIssues(source, issues);
  }

  if (issues.length > 0) {
    throw new Error(`Missing or invalid env vars: ${formatIssues(issues)}`);
  }

  if (!parsed.success) {
    throw new Error("Environment validation failed.");
  }

  return parsed.data;
}

export function getEnv(options: ValidateEnvOptions = {}) {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = validateEnv(process.env, options);
  return cachedEnv;
}
