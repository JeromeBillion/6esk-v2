import { z } from "zod";

const optionalString = z.string().optional();
const optionalUrl = z.union([z.string().url(), z.literal("")]).optional();

const envSchema = z.object({
  NODE_ENV: optionalString,
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  SESSION_COOKIE_NAME: optionalString,
  SESSION_TTL_DAYS: optionalString,
  AUTH_PROVIDER: optionalString,
  AUTH_OAUTH_ENABLED: optionalString,
  AUTH_REQUIRE_MFA_ADMIN: optionalString,
  AUTH_MFA_SECRET_ENCRYPTION_KEY: optionalString,
  AUTH_SESSION_DEVICE_TRACKING: optionalString,
  AUTH_BETTER_AUTH_ROUTE_ENABLED: optionalString,
  AUTH_BETTER_AUTH_DB_BRIDGE_READY: optionalString,
  AUTH_CACHE_PROVIDER: optionalString,
  AUTH_REDIS_URL: optionalString,
  BETTER_AUTH_SECRET: optionalString,
  BETTER_AUTH_URL: optionalUrl,
  AUTH_GOOGLE_CLIENT_ID: optionalString,
  AUTH_GOOGLE_CLIENT_SECRET: optionalString,
  AUTH_MICROSOFT_CLIENT_ID: optionalString,
  AUTH_MICROSOFT_CLIENT_SECRET: optionalString,
  AUTH_MICROSOFT_TENANT_ID: optionalString,
  AUTH_OIDC_ISSUER: optionalUrl,
  AUTH_OIDC_CLIENT_ID: optionalString,
  AUTH_OIDC_CLIENT_SECRET: optionalString,
  AUTH_ALLOWED_EMAIL_DOMAINS: optionalString,
  RESEND_API_KEY: z.string().min(1),
  RESEND_WEBHOOK_SECRET: z.string().min(1),
  RESEND_FROM_DOMAIN: z.string().min(1),
  SUPPORT_ADDRESS: z.string().min(1).optional(),
  INBOUND_SHARED_SECRET: z.string().min(1).optional(),
  AGENT_SECRET_KEY: z.string().min(16).optional(),
  AGENT_ORG_ID: optionalString,
  ADMIN_IP_ALLOWLIST: z.string().optional(),
  AGENT_IP_ALLOWLIST: z.string().optional(),
  INBOUND_ALERT_WEBHOOK: optionalUrl,
  SECURITY_ALERT_WEBHOOK: optionalUrl,
  INBOUND_ALERT_THRESHOLD: z.string().optional(),
  INBOUND_ALERT_WINDOW_MINUTES: z.string().optional(),
  INBOUND_ALERT_COOLDOWN_MINUTES: z.string().optional(),
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalString,
  RATE_LIMIT_ADMIN: optionalString,
  RATE_LIMIT_AGENT: optionalString,
  RATE_LIMIT_AUTH_LOGIN: optionalString,
  RATE_LIMIT_PORTAL_TICKET: optionalString,
  RATE_LIMIT_TICKET_CREATE: optionalString,
  RATE_LIMIT_TICKET_REPLY: optionalString,
  RATE_LIMIT_DRAFT_SEND: optionalString,
  RATE_LIMIT_EMAIL_SEND: optionalString,
  RATE_LIMIT_WHATSAPP_SEND: optionalString,
  RATE_LIMIT_WHATSAPP_RESEND: optionalString,
  RATE_LIMIT_WHATSAPP_INBOUND: optionalString,
  RATE_LIMIT_CALLS_OUTBOUND: optionalString,
  WHATSAPP_VERIFY_TOKEN: optionalString,
  WHATSAPP_APP_SECRET: optionalString,
  WHATSAPP_OUTBOX_SECRET: optionalString,
  WHATSAPP_GRAPH_VERSION: optionalString,
  TENANT_INGRESS_REQUIRE_SCOPE: optionalString,
  TENANT_INGRESS_REQUIRE_SIGNATURE: optionalString,
  TENANT_INGRESS_TENANT: optionalString,
  TENANT_INGRESS_WORKSPACE: optionalString,
  TENANT_INGRESS_SIGNATURE_MAX_SKEW_SECONDS: optionalString,
  TENANT_INGRESS_SIGNING_SECRETS_JSON: optionalString,
  TENANT_INGRESS_SIGNING_SECRET: optionalString,
  TENANT_INGRESS_ALLOW_GLOBAL_SIGNING_SECRET: optionalString,
  TENANT_INGRESS_SECRET_ENCRYPTION_KEY: optionalString,
  TENANT_PUBLIC_INGRESS_REQUIRE_ORIGIN: optionalString,
  TENANT_PUBLIC_INGRESS_ORIGINS_JSON: optionalString,
  TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS: optionalString,
  TENANT_QUERY_GUARD_MODE: optionalString,
  ENTITLEMENTS_FAIL_CLOSED: optionalString,
  MODULE_METERING_FAIL_CLOSED: optionalString,
  BILLING_VAT_RATE_PERCENT: optionalString,
  PROVIDER_WEBHOOK_SECRET_ENCRYPTION_KEY: optionalString,
  TENANT_PROVIDER_WEBHOOK_SECRETS_JSON: optionalString,
  CALLS_PROVIDER: optionalString,
  CALLS_PROVIDER_FROM_PHONE: optionalString,
  CALLS_PROVIDER_HTTP_URL: optionalUrl,
  CALLS_PROVIDER_HTTP_SECRET: optionalString,
  CALLS_PROVIDER_HTTP_TIMEOUT_MS: optionalString,
  CALLS_WEBHOOK_SECRET: optionalString,
  CALLS_WEBHOOK_MAX_SKEW_SECONDS: optionalString,
  CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE: optionalString,
  CALLS_OUTBOX_SECRET: optionalString,
  CALLS_TWILIO_ACCOUNT_SID: optionalString,
  CALLS_TWILIO_AUTH_TOKEN: optionalString,
  CALLS_TWILIO_API_KEY_SID: optionalString,
  CALLS_TWILIO_API_KEY_SECRET: optionalString,
  CALLS_TWILIO_TWIML_APP_SID: optionalString,
  CALLS_TWILIO_FROM_NUMBER: optionalString,
  CALLS_TWILIO_BRIDGE_TARGET: optionalString,
  CALLS_TWILIO_ALLOWED_CALLER_IDS: optionalString,
  CALLS_STT_PROVIDER: optionalString,
  CALLS_STT_PROVIDER_HTTP_URL: optionalUrl,
  CALLS_STT_PROVIDER_HTTP_SECRET: optionalString,
  CALLS_STT_DEEPGRAM_API_URL: optionalUrl,
  CALLS_STT_DEEPGRAM_API_KEY: optionalString,
  CALLS_STT_DEEPGRAM_CALLBACK_TOKEN: optionalString,
  CALLS_STT_DEEPGRAM_MODEL: optionalString,
  CALLS_STT_DEEPGRAM_LANGUAGE: optionalString,
  CALLS_TRANSCRIPT_SHARED_SECRET: optionalString,
  CALLS_TRANSCRIPT_AI_PROVIDER: optionalString,
  CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_URL: optionalUrl,
  CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_SECRET: optionalString,
  AI_PROVIDER: optionalString,
  AI_MODEL: optionalString,
  AI_API_KEY: optionalString,
  AI_BASE_URL: optionalUrl,
  OPENAI_API_KEY: optionalString,
  R2_ENDPOINT: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1)
}).superRefine((env, ctx) => {
  const isProduction = env.NODE_ENV === "production";
  const callsProvider = readLower(env.CALLS_PROVIDER ?? "mock");
  const sttProvider = readLower(env.CALLS_STT_PROVIDER ?? "managed_http");
  const transcriptAiProvider = readLower(env.CALLS_TRANSCRIPT_AI_PROVIDER ?? "managed_http");
  const aiProvider = readLower(env.AI_PROVIDER ?? "openai");
  const authProvider = readLower(env.AUTH_PROVIDER ?? "password");
  const authCacheProvider = readLower(env.AUTH_CACHE_PROVIDER ?? "none");
  const tenantQueryGuardMode = readLower(env.TENANT_QUERY_GUARD_MODE ?? "");
  const betterAuthRouteEnabled = readBoolean(env.AUTH_BETTER_AUTH_ROUTE_ENABLED) === true;
  const betterAuthDbBridgeReady = readBoolean(env.AUTH_BETTER_AUTH_DB_BRIDGE_READY) === true;
  const hasGoogleConfig = hasAnyValue(env.AUTH_GOOGLE_CLIENT_ID, env.AUTH_GOOGLE_CLIENT_SECRET);
  const hasMicrosoftConfig = hasAnyValue(
    env.AUTH_MICROSOFT_CLIENT_ID,
    env.AUTH_MICROSOFT_CLIENT_SECRET,
    env.AUTH_MICROSOFT_TENANT_ID
  );
  const hasGenericOidcConfig = hasAnyValue(
    env.AUTH_OIDC_ISSUER,
    env.AUTH_OIDC_CLIENT_ID,
    env.AUTH_OIDC_CLIENT_SECRET
  );
  const oauthEnabled =
    readBoolean(env.AUTH_OAUTH_ENABLED) === true ||
    authProvider === "better_auth" ||
    hasGoogleConfig ||
    hasMicrosoftConfig ||
    hasGenericOidcConfig;

  if (isProduction) {
    requireNonPlaceholder(ctx, env, "SESSION_SECRET");
    requireTrue(ctx, env, "AUTH_REQUIRE_MFA_ADMIN");
    requireNonPlaceholder(ctx, env, "AUTH_MFA_SECRET_ENCRYPTION_KEY");
    requireTrue(ctx, env, "AUTH_SESSION_DEVICE_TRACKING");
    requireNonPlaceholder(ctx, env, "RESEND_API_KEY");
    requireNonPlaceholder(ctx, env, "RESEND_WEBHOOK_SECRET");
    requireNonPlaceholder(ctx, env, "SECURITY_ALERT_WEBHOOK");
    requireNonPlaceholder(ctx, env, "R2_ACCESS_KEY_ID");
    requireNonPlaceholder(ctx, env, "R2_SECRET_ACCESS_KEY");
    requireNonPlaceholder(ctx, env, "UPSTASH_REDIS_REST_URL");
    requireNonPlaceholder(ctx, env, "UPSTASH_REDIS_REST_TOKEN");

    requireTrue(ctx, env, "TENANT_INGRESS_REQUIRE_SCOPE");
    requireTrue(ctx, env, "TENANT_INGRESS_REQUIRE_SIGNATURE");
    requireTrue(ctx, env, "TENANT_PUBLIC_INGRESS_REQUIRE_ORIGIN");
    requireTrue(ctx, env, "TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS");
    requireTrue(ctx, env, "ENTITLEMENTS_FAIL_CLOSED");
    requireTrue(ctx, env, "MODULE_METERING_FAIL_CLOSED");
    if (tenantQueryGuardMode === "off") {
      addIssue(ctx, "TENANT_QUERY_GUARD_MODE", "TENANT_QUERY_GUARD_MODE cannot be off in production.");
    }
    requireFalse(ctx, env, "TENANT_INGRESS_ALLOW_GLOBAL_SIGNING_SECRET");
    requireFalse(ctx, env, "CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE");

    requireJsonObject(ctx, env, "TENANT_INGRESS_SIGNING_SECRETS_JSON", { requireNonEmpty: true });
    requireJsonObject(ctx, env, "TENANT_PUBLIC_INGRESS_ORIGINS_JSON", { requireNonEmpty: true });
    requireJsonObject(ctx, env, "TENANT_PROVIDER_WEBHOOK_SECRETS_JSON", { requireNonEmpty: true });
    requireNonPlaceholder(ctx, env, "TENANT_INGRESS_SECRET_ENCRYPTION_KEY");
    requireNonPlaceholder(ctx, env, "PROVIDER_WEBHOOK_SECRET_ENCRYPTION_KEY");
  }

  if (!["password", "better_auth", "oidc_broker"].includes(authProvider)) {
    addIssue(ctx, "AUTH_PROVIDER", "AUTH_PROVIDER must be password, better_auth, or oidc_broker.");
  }

  if (!["none", "upstash", "valkey", "redis"].includes(authCacheProvider)) {
    addIssue(ctx, "AUTH_CACHE_PROVIDER", "AUTH_CACHE_PROVIDER must be none, upstash, valkey, or redis.");
  }

  if (tenantQueryGuardMode && !["off", "warn", "strict"].includes(tenantQueryGuardMode)) {
    addIssue(ctx, "TENANT_QUERY_GUARD_MODE", "TENANT_QUERY_GUARD_MODE must be off, warn, or strict.");
  }

  if (hasValue(env.BILLING_VAT_RATE_PERCENT)) {
    const vatRate = Number.parseFloat(env.BILLING_VAT_RATE_PERCENT ?? "");
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      addIssue(ctx, "BILLING_VAT_RATE_PERCENT", "BILLING_VAT_RATE_PERCENT must be a number from 0 to 100.");
    }
  }

  if (oauthEnabled) {
    requireNonPlaceholder(ctx, env, "BETTER_AUTH_SECRET");
    if (!hasGoogleConfig && !hasMicrosoftConfig && !hasGenericOidcConfig) {
      addIssue(
        ctx,
        "AUTH_OAUTH_ENABLED",
        "At least one Google, Microsoft, or generic OIDC provider must be configured when OAuth is enabled."
      );
    }
  }

  if (hasGoogleConfig) {
    requireNonPlaceholder(ctx, env, "AUTH_GOOGLE_CLIENT_ID");
    requireNonPlaceholder(ctx, env, "AUTH_GOOGLE_CLIENT_SECRET");
  }

  if (hasMicrosoftConfig) {
    requireNonPlaceholder(ctx, env, "AUTH_MICROSOFT_CLIENT_ID");
    requireNonPlaceholder(ctx, env, "AUTH_MICROSOFT_CLIENT_SECRET");
    requireNonPlaceholder(ctx, env, "AUTH_MICROSOFT_TENANT_ID");
  }

  if (hasGenericOidcConfig) {
    requireNonPlaceholder(ctx, env, "AUTH_OIDC_ISSUER");
    requireNonPlaceholder(ctx, env, "AUTH_OIDC_CLIENT_ID");
    requireNonPlaceholder(ctx, env, "AUTH_OIDC_CLIENT_SECRET");
  }

  if (authCacheProvider === "upstash") {
    requireNonPlaceholder(ctx, env, "UPSTASH_REDIS_REST_URL");
    requireNonPlaceholder(ctx, env, "UPSTASH_REDIS_REST_TOKEN");
  }

  if (hasValue(env.AUTH_MFA_SECRET_ENCRYPTION_KEY)) {
    requireNonPlaceholder(ctx, env, "AUTH_MFA_SECRET_ENCRYPTION_KEY");
  }

  if (["valkey", "redis"].includes(authCacheProvider)) {
    requireNonPlaceholder(ctx, env, "AUTH_REDIS_URL");
  }

  if (isProduction && oauthEnabled && authCacheProvider === "none") {
    addIssue(ctx, "AUTH_CACHE_PROVIDER", "OAuth production auth must use upstash, valkey, or redis cache.");
  }

  if (betterAuthRouteEnabled) {
    if (authProvider !== "better_auth") {
      addIssue(ctx, "AUTH_PROVIDER", "AUTH_PROVIDER must be better_auth when Better Auth routes are enabled.");
    }
    if (!betterAuthDbBridgeReady) {
      addIssue(
        ctx,
        "AUTH_BETTER_AUTH_DB_BRIDGE_READY",
        "Better Auth routes must stay disabled until the tenant-safe database bridge is ready."
      );
    }
  }

  if (callsProvider === "twilio") {
    requireNonPlaceholder(ctx, env, "CALLS_TWILIO_ACCOUNT_SID");
    requireNonPlaceholder(ctx, env, "CALLS_TWILIO_AUTH_TOKEN");
    requireNonPlaceholder(ctx, env, "CALLS_TWILIO_FROM_NUMBER");
    requireNonPlaceholder(ctx, env, "CALLS_TWILIO_BRIDGE_TARGET");
    requireNonPlaceholder(ctx, env, "CALLS_WEBHOOK_SECRET");
  }

  const hasTwilioClientConfig =
    hasValue(env.CALLS_TWILIO_API_KEY_SID) ||
    hasValue(env.CALLS_TWILIO_API_KEY_SECRET) ||
    hasValue(env.CALLS_TWILIO_TWIML_APP_SID);
  if (hasTwilioClientConfig) {
    requireNonPlaceholder(ctx, env, "CALLS_TWILIO_ACCOUNT_SID");
    requireNonPlaceholder(ctx, env, "CALLS_TWILIO_API_KEY_SID");
    requireNonPlaceholder(ctx, env, "CALLS_TWILIO_API_KEY_SECRET");
  }

  if (callsProvider === "http_bridge") {
    requireNonPlaceholder(ctx, env, "CALLS_PROVIDER_HTTP_URL");
  }

  if (sttProvider === "managed_http") {
    if (isProduction || hasValue(env.CALLS_STT_PROVIDER_HTTP_URL)) {
      requireNonPlaceholder(ctx, env, "CALLS_STT_PROVIDER_HTTP_URL");
      requireNonPlaceholder(ctx, env, "CALLS_STT_PROVIDER_HTTP_SECRET");
    }
  }

  if (isProduction || hasValue(env.CALLS_STT_DEEPGRAM_API_KEY)) {
    requireNonPlaceholder(ctx, env, "CALLS_STT_DEEPGRAM_API_KEY");
    requireNonPlaceholder(ctx, env, "CALLS_STT_DEEPGRAM_CALLBACK_TOKEN");
  }

  if (transcriptAiProvider === "managed_http" && hasValue(env.CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_URL)) {
    requireNonPlaceholder(ctx, env, "CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_SECRET");
  }

  if (isProduction && !["mock", "none", "disabled"].includes(aiProvider)) {
    if (!hasValue(env.AI_API_KEY) && !hasValue(env.OPENAI_API_KEY)) {
      addIssue(ctx, "AI_API_KEY", "AI_API_KEY or OPENAI_API_KEY is required in production.");
    }
    requireNonPlaceholder(ctx, env, "AI_MODEL");
  }
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

function readLower(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function hasValue(value: string | undefined | null) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasAnyValue(...values: Array<string | undefined | null>) {
  return values.some((value) => hasValue(value));
}

function looksPlaceholder(value: string) {
  return /^(replace-with|changeme|change-me|todo|example-|placeholder)/i.test(value.trim());
}

function addIssue(ctx: z.RefinementCtx, path: keyof Env | string, message: string) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [path],
    message
  });
}

function requireNonPlaceholder(ctx: z.RefinementCtx, env: Env, name: keyof Env) {
  const value = env[name];
  if (!hasValue(typeof value === "string" ? value : undefined)) {
    addIssue(ctx, name, `${String(name)} is required.`);
    return;
  }
  if (looksPlaceholder(value as string)) {
    addIssue(ctx, name, `${String(name)} must not use a placeholder value.`);
  }
}

function readBoolean(value: string | undefined | null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function requireTrue(ctx: z.RefinementCtx, env: Env, name: keyof Env) {
  if (readBoolean(env[name] as string | undefined) !== true) {
    addIssue(ctx, name, `${String(name)} must be true in production.`);
  }
}

function requireFalse(ctx: z.RefinementCtx, env: Env, name: keyof Env) {
  if (readBoolean(env[name] as string | undefined) !== false) {
    addIssue(ctx, name, `${String(name)} must be false in production.`);
  }
}

function requireJsonObject(
  ctx: z.RefinementCtx,
  env: Env,
  name: keyof Env,
  { requireNonEmpty }: { requireNonEmpty: boolean }
) {
  const raw = env[name];
  if (!hasValue(raw as string | undefined)) {
    addIssue(ctx, name, `${String(name)} is required.`);
    return;
  }
  try {
    const parsed = JSON.parse(raw as string);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      addIssue(ctx, name, `${String(name)} must be a JSON object.`);
      return;
    }
    if (requireNonEmpty && Object.keys(parsed).length === 0) {
      addIssue(ctx, name, `${String(name)} must not be empty.`);
    }
  } catch {
    addIssue(ctx, name, `${String(name)} must be valid JSON.`);
  }
}

export function validateEnv(input: NodeJS.ProcessEnv = process.env) {
  return envSchema.safeParse(input);
}

export function getEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = validateEnv(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Missing or invalid env vars: ${issues}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetEnvCacheForTests() {
  cachedEnv = null;
}
