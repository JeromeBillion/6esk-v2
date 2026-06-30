import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  checkCloudflareAccessHeaders: vi.fn()
}));

vi.mock("@6esk/auth/cloudflare-access", () => ({
  BACKOFFICE_ACCESS_EMAIL_HEADER: "x-sixesk-work-access-email",
  checkCloudflareAccessHeaders: mocks.checkCloudflareAccessHeaders
}));

import { middleware } from "../apps/backoffice/middleware";

describe("backoffice app middleware", () => {
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
});
