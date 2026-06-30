import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkCloudflareAccessHeaders: vi.fn()
}));

vi.mock("@6esk/auth/cloudflare-access", () => ({
  BACKOFFICE_ACCESS_EMAIL_HEADER: "x-sixesk-work-access-email",
  checkCloudflareAccessHeaders: mocks.checkCloudflareAccessHeaders
}));

import { middleware } from "../apps/backoffice/middleware";

const originalAuthLimit = process.env.RATE_LIMIT_AUTH_LOGIN;
const originalBackofficeLimit = process.env.RATE_LIMIT_BACKOFFICE;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("backoffice app middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__sixeskRateLimitMemory = new Map();
  });

  afterEach(() => {
    restoreEnv("RATE_LIMIT_AUTH_LOGIN", originalAuthLimit);
    restoreEnv("RATE_LIMIT_BACKOFFICE", originalBackofficeLimit);
    globalThis.__sixeskRateLimitMemory = new Map();
  });

  it("forwards verified Cloudflare Access identity to downstream handlers", async () => {
    mocks.checkCloudflareAccessHeaders.mockResolvedValue({
      ok: true,
      email: "ops@6esk.co.za",
      assertion: "jwt"
    });

    const response = await middleware(new NextRequest("http://localhost/dashboard"));

    expect(response.headers.get("x-sixesk-work-access-email")).toBe("ops@6esk.co.za");
    expect(response.headers.get("x-middleware-request-x-sixesk-work-access-email")).toBe(
      "ops@6esk.co.za"
    );
    expect(response.headers.get("x-middleware-override-headers")).toContain(
      "x-sixesk-work-access-email"
    );
  });

  it("fails closed when Cloudflare Access verification fails", async () => {
    mocks.checkCloudflareAccessHeaders.mockResolvedValue({
      ok: false,
      status: 403,
      reason: "Cloudflare Access identity headers are required for 6esk Work."
    });

    const response = await middleware(new NextRequest("http://localhost/dashboard"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Cloudflare Access identity headers are required for 6esk Work."
    });
  });

  it("rate limits backoffice API hits before Access verification work", async () => {
    process.env.RATE_LIMIT_BACKOFFICE = "1";
    mocks.checkCloudflareAccessHeaders.mockResolvedValue({
      ok: true,
      email: "ops@6esk.co.za",
      assertion: "jwt"
    });

    const first = await middleware(
      new NextRequest("http://localhost/api/backoffice/cases", {
        headers: { "x-forwarded-for": "203.0.113.55" }
      })
    );
    const second = await middleware(
      new NextRequest("http://localhost/api/backoffice/cases", {
        headers: { "x-forwarded-for": "203.0.113.55" }
      })
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(mocks.checkCloudflareAccessHeaders).toHaveBeenCalledTimes(1);
  });

  it("rate limits backoffice login attempts independently of root middleware", async () => {
    process.env.RATE_LIMIT_AUTH_LOGIN = "1";
    mocks.checkCloudflareAccessHeaders.mockResolvedValue({
      ok: true,
      email: "ops@6esk.co.za",
      assertion: "jwt"
    });

    const first = await middleware(
      new NextRequest("http://localhost/api/auth/login", {
        headers: { "x-forwarded-for": "203.0.113.99" }
      })
    );
    const second = await middleware(
      new NextRequest("http://localhost/api/auth/login", {
        headers: { "x-forwarded-for": "203.0.113.99" }
      })
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(mocks.checkCloudflareAccessHeaders).toHaveBeenCalledTimes(1);
  });
});
