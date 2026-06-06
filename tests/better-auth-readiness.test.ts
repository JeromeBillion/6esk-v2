import { describe, expect, it } from "vitest";
import { getBetterAuthReadiness } from "@/server/auth/better-auth-readiness";

describe("Better Auth readiness", () => {
  it("keeps local password auth disabled without blockers", () => {
    const readiness = getBetterAuthReadiness({
      NODE_ENV: "development",
      AUTH_PROVIDER: "password",
      AUTH_OAUTH_ENABLED: "false",
      AUTH_REQUIRE_MFA_ADMIN: "true",
      AUTH_SESSION_DEVICE_TRACKING: "true",
      AUTH_CACHE_PROVIDER: "none"
    });

    expect(readiness).toMatchObject({
      packageInstalled: true,
      enabled: false,
      ready: false,
      blockers: [],
      cache: { provider: "none", required: false, configured: true }
    });
  });

  it("reports missing Better Auth provider and secret configuration", () => {
    const readiness = getBetterAuthReadiness({
      NODE_ENV: "production",
      AUTH_PROVIDER: "better_auth",
      AUTH_OAUTH_ENABLED: "true",
      AUTH_REQUIRE_MFA_ADMIN: "true",
      AUTH_SESSION_DEVICE_TRACKING: "true",
      AUTH_CACHE_PROVIDER: "none"
    });

    expect(readiness.enabled).toBe(true);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        "BETTER_AUTH_SECRET is missing.",
        "At least one Google, Microsoft, or OIDC provider must be fully configured."
      ])
    );
  });

  it("recognizes complete Google OAuth config while keeping the bridge gated", () => {
    const readiness = getBetterAuthReadiness({
      NODE_ENV: "production",
      AUTH_PROVIDER: "better_auth",
      AUTH_OAUTH_ENABLED: "true",
      AUTH_REQUIRE_MFA_ADMIN: "true",
      AUTH_SESSION_DEVICE_TRACKING: "true",
      AUTH_BETTER_AUTH_ROUTE_ENABLED: "false",
      AUTH_BETTER_AUTH_DB_BRIDGE_READY: "false",
      BETTER_AUTH_SECRET: "better-auth-secret-with-enough-length",
      AUTH_GOOGLE_CLIENT_ID: "google-client",
      AUTH_GOOGLE_CLIENT_SECRET: "google-secret",
      AUTH_CACHE_PROVIDER: "upstash",
      UPSTASH_REDIS_REST_URL: "https://redis.example.com",
      UPSTASH_REDIS_REST_TOKEN: "redis-token",
      AUTH_ALLOWED_EMAIL_DOMAINS: "example.com,acme.test"
    });

    expect(readiness.providers.find((provider) => provider.id === "google")).toMatchObject({
      configured: true,
      missing: []
    });
    expect(readiness.cache).toEqual({ provider: "upstash", required: true, configured: true });
    expect(readiness.policy.allowedEmailDomains).toEqual(["example.com", "acme.test"]);
    expect(readiness.ready).toBe(false);
  });

  it("blocks route enablement until the database bridge is marked ready", () => {
    const readiness = getBetterAuthReadiness({
      NODE_ENV: "production",
      AUTH_PROVIDER: "better_auth",
      AUTH_OAUTH_ENABLED: "true",
      AUTH_REQUIRE_MFA_ADMIN: "true",
      AUTH_SESSION_DEVICE_TRACKING: "true",
      AUTH_BETTER_AUTH_ROUTE_ENABLED: "true",
      AUTH_BETTER_AUTH_DB_BRIDGE_READY: "false",
      BETTER_AUTH_SECRET: "better-auth-secret-with-enough-length",
      AUTH_GOOGLE_CLIENT_ID: "google-client",
      AUTH_GOOGLE_CLIENT_SECRET: "google-secret",
      AUTH_CACHE_PROVIDER: "upstash",
      UPSTASH_REDIS_REST_URL: "https://redis.example.com",
      UPSTASH_REDIS_REST_TOKEN: "redis-token"
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.blockers).toContain("Tenant-safe Better Auth database bridge is not marked ready.");
  });

  it("requires full OIDC client configuration before marking OIDC configured", () => {
    const readiness = getBetterAuthReadiness({
      NODE_ENV: "development",
      AUTH_PROVIDER: "better_auth",
      AUTH_OAUTH_ENABLED: "true",
      AUTH_REQUIRE_MFA_ADMIN: "true",
      AUTH_SESSION_DEVICE_TRACKING: "true",
      AUTH_BETTER_AUTH_ROUTE_ENABLED: "true",
      AUTH_BETTER_AUTH_DB_BRIDGE_READY: "true",
      BETTER_AUTH_SECRET: "better-auth-secret-with-enough-length",
      AUTH_OIDC_ISSUER: "https://idp.example.com",
      AUTH_CACHE_PROVIDER: "none"
    });

    expect(readiness.providers.find((provider) => provider.id === "oidc")).toMatchObject({
      configured: false,
      missing: ["AUTH_OIDC_CLIENT_ID", "AUTH_OIDC_CLIENT_SECRET"]
    });
    expect(readiness.ready).toBe(false);
  });
});
