import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processInboundEmailPayload: vi.fn()
}));

vi.mock("@/server/email/process-inbound", () => ({
  processInboundEmailPayload: mocks.processInboundEmailPayload
}));

const ORIGINAL_ENV = { ...process.env };

describe("POST /api/email/inbound auth", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.INBOUND_SHARED_SECRET;
    delete process.env.INBOUND_ALLOW_UNAUTHENTICATED;
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("fails closed in production when the shared secret is missing", async () => {
    process.env.NODE_ENV = "production";
    const { POST } = await import("@/app/api/email/inbound/route");

    const response = await POST(
      new Request("https://desk.example.com/api/email/inbound", {
        method: "POST",
        body: JSON.stringify({ from: "user@example.com", to: ["support@example.com"] })
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.processInboundEmailPayload).not.toHaveBeenCalled();
  });
});
