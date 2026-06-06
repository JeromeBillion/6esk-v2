import { describe, expect, it } from "vitest";
import { validateEnv } from "@/server/env";

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    APP_URL: "https://app.example.com",
    DATABASE_URL: "postgres://user:pass@example.com:5432/6esk",
    SESSION_SECRET: "session-secret-with-enough-length",
    AUTH_PROVIDER: "password",
    AUTH_REQUIRE_MFA_ADMIN: "true",
    AUTH_MFA_SECRET_ENCRYPTION_KEY: "mfa-secret-encryption-key-32-bytes",
    AUTH_SESSION_DEVICE_TRACKING: "true",
    AUTH_BETTER_AUTH_ROUTE_ENABLED: "false",
    AUTH_BETTER_AUTH_DB_BRIDGE_READY: "false",
    AUTH_CACHE_PROVIDER: "none",
    RESEND_API_KEY: "resend-key",
    RESEND_WEBHOOK_SECRET: "resend-webhook-secret",
    RESEND_FROM_DOMAIN: "example.com",
    SECURITY_ALERT_WEBHOOK: "https://alerts.example.com/security",
    INBOUND_SHARED_SECRET: "inbound-secret",
    AGENT_SECRET_KEY: "agent-secret-with-enough-length",
    UPSTASH_REDIS_REST_URL: "https://upstash.example.com",
    UPSTASH_REDIS_REST_TOKEN: "upstash-token",
    TENANT_INGRESS_REQUIRE_SCOPE: "true",
    TENANT_INGRESS_REQUIRE_SIGNATURE: "true",
    TENANT_INGRESS_ALLOW_GLOBAL_SIGNING_SECRET: "false",
    TENANT_INGRESS_SIGNING_SECRETS_JSON: JSON.stringify({
      "tenant-a:workspace-a": "tenant-ingress-signing-secret"
    }),
    TENANT_INGRESS_SECRET_ENCRYPTION_KEY: "tenant-ingress-encryption-key-32-bytes",
    TENANT_PUBLIC_INGRESS_REQUIRE_ORIGIN: "true",
    TENANT_PUBLIC_INGRESS_ORIGINS_JSON: JSON.stringify({
      "https://support.example.com": { tenantKey: "tenant-a", workspaceKey: "workspace-a" }
    }),
    TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS: "true",
    PROVIDER_WEBHOOK_SECRET_ENCRYPTION_KEY: "provider-webhook-encryption-key-32-bytes",
    TENANT_PROVIDER_WEBHOOK_SECRETS_JSON: JSON.stringify({
      "tenant-a:workspace-a:resend:webhook_secret": "resend-secret"
    }),
    ENTITLEMENTS_FAIL_CLOSED: "true",
    MODULE_METERING_FAIL_CLOSED: "true",
    BILLING_VAT_RATE_PERCENT: "15",
    CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE: "false",
    CALLS_PROVIDER: "mock",
    CALLS_STT_PROVIDER: "mock",
    CALLS_STT_DEEPGRAM_API_KEY: "deepgram-key",
    CALLS_STT_DEEPGRAM_CALLBACK_TOKEN: "deepgram-callback-token",
    AI_PROVIDER: "openai",
    AI_MODEL: "gpt-5-mini",
    AI_API_KEY: "ai-key",
    AI_BASE_URL: "https://api.openai.com/v1",
    R2_ENDPOINT: "https://r2.example.com",
    R2_ACCESS_KEY_ID: "r2-key",
    R2_SECRET_ACCESS_KEY: "r2-secret",
    R2_BUCKET: "6esk-emails",
    ...overrides
  };
}

function issuePaths(result: ReturnType<typeof validateEnv>) {
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join("."));
}

describe("env validation", () => {
  it("accepts a strict production-ready environment", () => {
    expect(validateEnv(baseEnv()).success).toBe(true);
  });

  it("rejects disabled production tenant and webhook strict flags", () => {
    const result = validateEnv(
      baseEnv({
        TENANT_INGRESS_REQUIRE_SCOPE: "false",
        TENANT_INGRESS_REQUIRE_SIGNATURE: "false",
        TENANT_PUBLIC_INGRESS_REQUIRE_ORIGIN: "false",
        TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS: "false",
        TENANT_QUERY_GUARD_MODE: "off",
        ENTITLEMENTS_FAIL_CLOSED: "false",
        MODULE_METERING_FAIL_CLOSED: "false",
        TENANT_INGRESS_ALLOW_GLOBAL_SIGNING_SECRET: "true",
        CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE: "true"
      })
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining([
        "TENANT_INGRESS_REQUIRE_SCOPE",
        "TENANT_INGRESS_REQUIRE_SIGNATURE",
        "TENANT_PUBLIC_INGRESS_REQUIRE_ORIGIN",
        "TENANT_PROVIDER_WEBHOOK_REQUIRE_SECRETS",
        "TENANT_QUERY_GUARD_MODE",
        "ENTITLEMENTS_FAIL_CLOSED",
        "MODULE_METERING_FAIL_CLOSED",
        "TENANT_INGRESS_ALLOW_GLOBAL_SIGNING_SECRET",
        "CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE"
      ])
    );
  });

  it("rejects invalid tenant query guard modes", () => {
    const result = validateEnv(
      baseEnv({
        TENANT_QUERY_GUARD_MODE: "observe"
      })
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(expect.arrayContaining(["TENANT_QUERY_GUARD_MODE"]));
  });

  it("rejects invalid billing VAT rates", () => {
    const result = validateEnv(
      baseEnv({
        BILLING_VAT_RATE_PERCENT: "not-a-rate"
      })
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(expect.arrayContaining(["BILLING_VAT_RATE_PERCENT"]));
  });

  it("requires Twilio live call configuration when Twilio is selected", () => {
    const result = validateEnv(
      baseEnv({
        CALLS_PROVIDER: "twilio",
        CALLS_TWILIO_ACCOUNT_SID: "",
        CALLS_TWILIO_AUTH_TOKEN: "",
        CALLS_TWILIO_FROM_NUMBER: "",
        CALLS_TWILIO_BRIDGE_TARGET: "",
        CALLS_WEBHOOK_SECRET: ""
      })
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining([
        "CALLS_TWILIO_ACCOUNT_SID",
        "CALLS_TWILIO_AUTH_TOKEN",
        "CALLS_TWILIO_FROM_NUMBER",
        "CALLS_TWILIO_BRIDGE_TARGET",
        "CALLS_WEBHOOK_SECRET"
      ])
    );
  });

  it("requires Deepgram callback and API secrets in production", () => {
    const result = validateEnv(
      baseEnv({
        CALLS_STT_DEEPGRAM_API_KEY: "",
        CALLS_STT_DEEPGRAM_CALLBACK_TOKEN: ""
      })
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining([
        "CALLS_STT_DEEPGRAM_API_KEY",
        "CALLS_STT_DEEPGRAM_CALLBACK_TOKEN"
      ])
    );
  });

  it("rejects production placeholder secrets", () => {
    const result = validateEnv(
      baseEnv({
        SESSION_SECRET: "replace-with-long-random-string",
        AI_API_KEY: "replace-with-global-ai-key",
        SECURITY_ALERT_WEBHOOK: ""
      })
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(expect.arrayContaining(["SESSION_SECRET", "SECURITY_ALERT_WEBHOOK"]));
  });

  it("requires privileged MFA and session tracking in production", () => {
    const result = validateEnv(
      baseEnv({
        AUTH_REQUIRE_MFA_ADMIN: "false",
        AUTH_MFA_SECRET_ENCRYPTION_KEY: "",
        AUTH_SESSION_DEVICE_TRACKING: "false"
      })
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining([
        "AUTH_REQUIRE_MFA_ADMIN",
        "AUTH_MFA_SECRET_ENCRYPTION_KEY",
        "AUTH_SESSION_DEVICE_TRACKING"
      ])
    );
  });

  it("requires a complete OAuth provider and cache when Better Auth is enabled", () => {
    const result = validateEnv(
      baseEnv({
        AUTH_PROVIDER: "better_auth",
        AUTH_OAUTH_ENABLED: "true",
        BETTER_AUTH_SECRET: "",
        AUTH_GOOGLE_CLIENT_ID: "google-client",
        AUTH_GOOGLE_CLIENT_SECRET: "",
        AUTH_CACHE_PROVIDER: "none"
      })
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining([
        "BETTER_AUTH_SECRET",
        "AUTH_GOOGLE_CLIENT_SECRET",
        "AUTH_CACHE_PROVIDER"
      ])
    );
  });

  it("accepts Better Auth with Google OAuth and Upstash cache", () => {
    const result = validateEnv(
      baseEnv({
        AUTH_PROVIDER: "better_auth",
        AUTH_OAUTH_ENABLED: "true",
        BETTER_AUTH_SECRET: "better-auth-secret-with-enough-length",
        AUTH_GOOGLE_CLIENT_ID: "google-client",
        AUTH_GOOGLE_CLIENT_SECRET: "google-secret",
        AUTH_CACHE_PROVIDER: "upstash"
      })
    );

    expect(result.success).toBe(true);
  });

  it("requires a Redis-compatible URL for Valkey auth cache", () => {
    const result = validateEnv(
      baseEnv({
        AUTH_CACHE_PROVIDER: "valkey",
        AUTH_REDIS_URL: ""
      })
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(expect.arrayContaining(["AUTH_REDIS_URL"]));
  });

  it("requires complete generic OIDC configuration when OIDC is selected", () => {
    const result = validateEnv(
      baseEnv({
        AUTH_PROVIDER: "better_auth",
        AUTH_OAUTH_ENABLED: "true",
        BETTER_AUTH_SECRET: "better-auth-secret-with-enough-length",
        AUTH_OIDC_ISSUER: "https://idp.example.com",
        AUTH_OIDC_CLIENT_ID: "",
        AUTH_OIDC_CLIENT_SECRET: "",
        AUTH_CACHE_PROVIDER: "upstash"
      })
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining(["AUTH_OIDC_CLIENT_ID", "AUTH_OIDC_CLIENT_SECRET"])
    );
  });

  it("blocks Better Auth route enablement before the database bridge is ready", () => {
    const result = validateEnv(
      baseEnv({
        AUTH_PROVIDER: "better_auth",
        AUTH_OAUTH_ENABLED: "true",
        AUTH_BETTER_AUTH_ROUTE_ENABLED: "true",
        AUTH_BETTER_AUTH_DB_BRIDGE_READY: "false",
        BETTER_AUTH_SECRET: "better-auth-secret-with-enough-length",
        AUTH_GOOGLE_CLIENT_ID: "google-client",
        AUTH_GOOGLE_CLIENT_SECRET: "google-secret",
        AUTH_CACHE_PROVIDER: "upstash"
      })
    );

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(expect.arrayContaining(["AUTH_BETTER_AUTH_DB_BRIDGE_READY"]));
  });
});
