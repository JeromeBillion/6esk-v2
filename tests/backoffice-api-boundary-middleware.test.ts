import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkCloudflareAccessHeaders: vi.fn()
}));

vi.mock("@6esk/auth/cloudflare-access", () => ({
  checkCloudflareAccessHeaders: mocks.checkCloudflareAccessHeaders
}));

import { isBackofficeApiPath, middleware } from "@/middleware";

const originalBackofficeLimit = process.env.RATE_LIMIT_BACKOFFICE;

function event() {
  return { waitUntil: vi.fn() } as any;
}

describe("root middleware backoffice boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__sixeskRateLimitMemory = new Map();
  });

  afterEach(() => {
    process.env.RATE_LIMIT_BACKOFFICE = originalBackofficeLimit;
    globalThis.__sixeskRateLimitMemory = new Map();
  });

  it("identifies backoffice API paths without matching tenant/admin APIs", () => {
    expect(isBackofficeApiPath("/api/backoffice")).toBe(true);
    expect(isBackofficeApiPath("/api/backoffice/cases")).toBe(true);
    expect(isBackofficeApiPath("/api/admin/tenants")).toBe(false);
    expect(isBackofficeApiPath("/api/tickets/create")).toBe(false);
  });

  it("fails closed before root backoffice APIs can bypass Cloudflare Access", async () => {
    mocks.checkCloudflareAccessHeaders.mockResolvedValue({
      ok: false,
      status: 403,
      reason: "Cloudflare Access identity headers are required for 6esk Work."
    });

    const response = await middleware(
      new NextRequest("http://localhost/api/backoffice/cases"),
      event()
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Cloudflare Access identity headers are required for 6esk Work."
    });
  });

  it("rate limits repeated backoffice hits before Access verification work", async () => {
    process.env.RATE_LIMIT_BACKOFFICE = "1";
    mocks.checkCloudflareAccessHeaders.mockResolvedValue({
      ok: false,
      status: 403,
      reason: "Cloudflare Access identity headers are required for 6esk Work."
    });

    const first = await middleware(
      new NextRequest("http://localhost/api/backoffice/cases", {
        headers: { "x-forwarded-for": "203.0.113.44" }
      }),
      event()
    );
    const second = await middleware(
      new NextRequest("http://localhost/api/backoffice/cases", {
        headers: { "x-forwarded-for": "203.0.113.44" }
      }),
      event()
    );

    expect(first.status).toBe(403);
    expect(second.status).toBe(429);
    expect(mocks.checkCloudflareAccessHeaders).toHaveBeenCalledTimes(1);
  });
});
