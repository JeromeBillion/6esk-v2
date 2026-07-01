import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { applyRateLimit } from "@/server/rate-limit-middleware";

const originalAuthLimit = process.env.RATE_LIMIT_AUTH_LOGIN;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("rate limit middleware", () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_AUTH_LOGIN = "1";
    globalThis.__sixeskRateLimitMemory = new Map();
  });

  afterEach(() => {
    restoreEnv("RATE_LIMIT_AUTH_LOGIN", originalAuthLimit);
    globalThis.__sixeskRateLimitMemory = new Map();
  });

  it("does not let auth attackers rotate tenant headers to bypass the IP bucket", async () => {
    const first = await applyRateLimit(
      new NextRequest("http://localhost/api/auth/login", {
        headers: {
          "x-forwarded-for": "203.0.113.77",
          "x-6esk-tenant": "tenant-a",
          "x-6esk-workspace": "workspace-a"
        }
      })
    );
    const second = await applyRateLimit(
      new NextRequest("http://localhost/api/auth/login", {
        headers: {
          "x-forwarded-for": "203.0.113.77",
          "x-6esk-tenant": "tenant-b",
          "x-6esk-workspace": "workspace-b"
        }
      })
    );

    expect(first).toMatchObject({ success: true, limit: 1 });
    expect(second).toMatchObject({ success: false, limit: 1 });
  });
});
