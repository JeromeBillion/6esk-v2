import { describe, expect, it } from "vitest";
import {
  buildRateLimitKey,
  rateLimitIdentityFromHeaders,
  readRateLimitValue,
  resolveRateLimitProfile
} from "@/server/rate-limit";

describe("central rate limit routing", () => {
  it("maps sensitive API routes to rate limit profiles", () => {
    expect(resolveRateLimitProfile("/api/auth/login")).toMatchObject({
      id: "auth-login",
      envName: "RATE_LIMIT_AUTH_LOGIN"
    });
    expect(resolveRateLimitProfile("/api/auth/password-reset")).toMatchObject({
      id: "auth-login",
      envName: "RATE_LIMIT_AUTH_LOGIN"
    });
    expect(resolveRateLimitProfile("/api/auth/oauth/authorize")).toMatchObject({
      id: "auth-login",
      envName: "RATE_LIMIT_AUTH_LOGIN"
    });
    expect(resolveRateLimitProfile("/api/auth/mfa/challenge")).toMatchObject({
      id: "auth-login",
      envName: "RATE_LIMIT_AUTH_LOGIN"
    });
    expect(resolveRateLimitProfile("/api/auth/mfa/enroll/verify")).toMatchObject({
      id: "auth-login",
      envName: "RATE_LIMIT_AUTH_LOGIN"
    });
    expect(resolveRateLimitProfile("/api/tickets/create")).toMatchObject({
      id: "ticket-create",
      envName: "RATE_LIMIT_TICKET_CREATE"
    });
    expect(resolveRateLimitProfile("/api/tickets/ticket-1/replies")).toMatchObject({
      id: "ticket-reply",
      envName: "RATE_LIMIT_TICKET_REPLY"
    });
    expect(resolveRateLimitProfile("/api/admin/security")).toMatchObject({
      id: "admin",
      envName: "RATE_LIMIT_ADMIN"
    });
    expect(resolveRateLimitProfile("/api/backoffice/cases")).toMatchObject({
      id: "backoffice",
      envName: "RATE_LIMIT_BACKOFFICE"
    });
    expect(resolveRateLimitProfile("/api/health")).toBeNull();
  });

  it("builds tenant and client scoped keys", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 198.51.100.20",
      "x-6esk-tenant": "tenant-a",
      "x-6esk-workspace": "workspace-a"
    });
    const profile = resolveRateLimitProfile("/api/agent/v1/actions");

    expect(profile).toMatchObject({ id: "agent" });
    expect(rateLimitIdentityFromHeaders(headers)).toBe("203.0.113.10");
    expect(buildRateLimitKey({ profile: profile!, headers })).toBe(
      "rate-limit:agent:tenant-a:workspace-a:203.0.113.10"
    );
  });

  it("prefers trusted proxy identity headers over forwarded headers", () => {
    const headers = new Headers({
      "cf-connecting-ip": "198.51.100.50",
      "x-real-ip": "198.51.100.20",
      "x-forwarded-for": "203.0.113.10"
    });

    expect(rateLimitIdentityFromHeaders(headers)).toBe("198.51.100.50");
  });

  it("sanitizes rate limit identity and tenant key parts", () => {
    const profile = resolveRateLimitProfile("/api/agent/v1/actions");
    const headers = new Headers({
      "x-forwarded-for": "bad value with spaces, 203.0.113.10",
      "x-real-ip": "also invalid",
      "x-6esk-tenant": "tenant-a/../../other",
      "x-6esk-workspace": "workspace-a"
    });

    expect(profile).toMatchObject({ id: "agent" });
    expect(rateLimitIdentityFromHeaders(headers)).toBe("unknown");
    expect(buildRateLimitKey({ profile: profile!, headers })).toBe(
      "rate-limit:agent:unscoped:unknown"
    );
  });

  it("rejects oversized rate limit key parts", () => {
    const headers = new Headers({
      "cf-connecting-ip": "a".repeat(120)
    });

    expect(rateLimitIdentityFromHeaders(headers)).toBe("unknown");
  });

  it("normalizes configured limits", () => {
    expect(readRateLimitValue("15", 20)).toBe(15);
    expect(readRateLimitValue("0", 20)).toBe(0);
    expect(readRateLimitValue("-1", 20)).toBe(0);
    expect(readRateLimitValue("not-a-number", 20)).toBe(20);
  });
});
