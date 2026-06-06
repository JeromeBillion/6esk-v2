import { describe, expect, it } from "vitest";
import { validateEnv } from "@/server/env";

function baseEnv() {
  return {
    NODE_ENV: "production",
    APP_URL: "https://app.6esk.example",
    DATABASE_URL: "postgres://user:pass@localhost:5432/6esk",
    SESSION_SECRET: "replace-with-a-long-session-secret",
    RESEND_API_KEY: "resend-key",
    RESEND_WEBHOOK_SECRET: "resend-webhook-secret",
    RESEND_FROM_DOMAIN: "6ex.co.za",
    R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "r2-key",
    R2_SECRET_ACCESS_KEY: "r2-secret",
    R2_BUCKET: "6esk-emails",
    INBOUND_SHARED_SECRET: "inbound-secret",
    AGENT_SECRET_KEY: "agent-secret-long-enough",
    AUTH_MFA_SECRET_ENCRYPTION_KEY: "d".repeat(64),
    AUTH_REQUIRE_MFA_ADMIN: "true",
    AUTH_MFA_ISSUER: "6esk",
    TENANT_INGRESS_SECRET_ENCRYPTION_KEY: "b".repeat(64),
    PROVIDER_WEBHOOK_SECRET_ENCRYPTION_KEY: "c".repeat(64),
    CRON_SECRET: "cron-secret",
    OAUTH_ENCRYPTION_KEY: "a".repeat(64),
    WHATSAPP_VERIFY_TOKEN: "whatsapp-verify",
    WHATSAPP_APP_SECRET: "whatsapp-app-secret",
    WHATSAPP_OUTBOX_SECRET: "whatsapp-outbox-secret",
    AI_API_KEY: "ai-key",
    CALLS_PROVIDER: "twilio",
    CALLS_TWILIO_ACCOUNT_SID: "AC123",
    CALLS_TWILIO_AUTH_TOKEN: "twilio-auth",
    CALLS_TWILIO_API_KEY_SID: "SK123",
    CALLS_TWILIO_API_KEY_SECRET: "twilio-api-secret",
    CALLS_TWILIO_FROM_NUMBER: "+27110000000",
    CALLS_WEBHOOK_SECRET: "calls-webhook-secret",
    CALLS_OUTBOX_SECRET: "calls-outbox-secret",
    CALLS_STT_PROVIDER: "managed_http",
    CALLS_STT_PROVIDER_HTTP_URL: "https://app.6esk.example/api/internal/calls/stt/deepgram",
    CALLS_STT_PROVIDER_HTTP_SECRET: "stt-provider-secret",
    CALLS_STT_DEEPGRAM_API_KEY: "deepgram-key",
    CALLS_STT_DEEPGRAM_CALLBACK_TOKEN: "deepgram-callback-token",
    CALLS_TRANSCRIPT_AI_PROVIDER: "managed_http",
    CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_SECRET: "transcript-ai-secret",
    UPSTASH_REDIS_REST_URL: "https://redis.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "redis-token"
  };
}

describe("validateEnv", () => {
  it("accepts a complete production runtime configuration", () => {
    expect(() => validateEnv(baseEnv())).not.toThrow();
  });

  it("fails production startup for mock or missing critical integration settings", () => {
    const env = {
      ...baseEnv(),
      CALLS_PROVIDER: "mock",
      CRON_SECRET: "",
      AUTH_MFA_SECRET_ENCRYPTION_KEY: "",
      TENANT_INGRESS_SECRET_ENCRYPTION_KEY: "",
      PROVIDER_WEBHOOK_SECRET_ENCRYPTION_KEY: "",
      AI_API_KEY: "",
      OPENAI_API_KEY: "",
      UPSTASH_REDIS_REST_TOKEN: ""
    };

    expect(() => validateEnv(env)).toThrow(/CRON_SECRET/);
    expect(() => validateEnv(env)).toThrow(/AUTH_MFA_SECRET_ENCRYPTION_KEY/);
    expect(() => validateEnv(env)).toThrow(/TENANT_INGRESS_SECRET_ENCRYPTION_KEY/);
    expect(() => validateEnv(env)).toThrow(/PROVIDER_WEBHOOK_SECRET_ENCRYPTION_KEY/);
    expect(() => validateEnv(env)).toThrow(/AI_API_KEY\|OPENAI_API_KEY/);
    expect(() => validateEnv(env)).toThrow(/CALLS_PROVIDER must not be mock/);
    expect(() => validateEnv(env)).toThrow(/UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN/);
  });

  it("fails production startup for partial OAuth provider configuration", () => {
    const env = {
      ...baseEnv(),
      GOOGLE_OAUTH_CLIENT_ID: "google-client-id"
    };

    expect(() => validateEnv(env)).toThrow(/GOOGLE_OAUTH_CLIENT_SECRET/);
    expect(() => validateEnv(env)).toThrow(/GOOGLE_OAUTH_REDIRECT_URI/);
  });

  it("requires explicit alpha acknowledgement when Dexter runtime is enabled in production", () => {
    const envWithoutAck = {
      ...baseEnv(),
      DEXTER_RUNTIME_ENABLED: "true",
      DEXTER_RUNTIME_ALPHA_ACK: ""
    };
    const envWithAck = {
      ...baseEnv(),
      DEXTER_RUNTIME_ENABLED: "true",
      DEXTER_RUNTIME_ALPHA_ACK: "true"
    };

    expect(() => validateEnv(envWithoutAck)).toThrow(/DEXTER_RUNTIME_ALPHA_ACK/);
    expect(() => validateEnv(envWithAck)).not.toThrow();
  });

  it("requires bridge configuration when Dexter runtime uses http_bridge mode", () => {
    const missingBridgeUrl = {
      ...baseEnv(),
      DEXTER_RUNTIME_ENABLED: "true",
      DEXTER_RUNTIME_ALPHA_ACK: "true",
      DEXTER_RUNTIME_MODE: "http_bridge",
      DEXTER_RUNTIME_HTTP_URL: "",
      DEXTER_RUNTIME_HTTP_SECRET: ""
    };
    const configuredBridge = {
      ...baseEnv(),
      DEXTER_RUNTIME_ENABLED: "true",
      DEXTER_RUNTIME_ALPHA_ACK: "true",
      DEXTER_RUNTIME_MODE: "http_bridge",
      DEXTER_RUNTIME_HTTP_URL: "https://dexter-runtime.6esk.example",
      DEXTER_RUNTIME_HTTP_SECRET: "bridge-secret"
    };

    expect(() => validateEnv(missingBridgeUrl)).toThrow(/DEXTER_RUNTIME_HTTP_URL/);
    expect(() => validateEnv(configuredBridge)).not.toThrow();
  });

  it("keeps local development flexible while preserving base schema checks", () => {
    const env = {
      ...baseEnv(),
      NODE_ENV: "development",
      CALLS_PROVIDER: "mock",
      CRON_SECRET: "",
      AI_API_KEY: "",
      UPSTASH_REDIS_REST_TOKEN: ""
    };

    expect(() => validateEnv(env)).not.toThrow();
  });
});
