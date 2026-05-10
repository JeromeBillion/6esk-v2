import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  retryFailedWhatsAppEvents: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/whatsapp/outbox", () => ({
  retryFailedWhatsAppEvents: mocks.retryFailedWhatsAppEvents
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/admin/whatsapp/retry/route";

const ORIGINAL_ENV = { ...process.env };
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: TENANT_ID
  };
}

describe("POST /api/admin/whatsapp/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, WHATSAPP_OUTBOX_SECRET: "wa-secret" };
    mocks.retryFailedWhatsAppEvents.mockResolvedValue({
      requested: 10,
      retried: 3,
      ids: ["a", "b", "c"]
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns 401 for non-admin users without secret", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await POST(new Request("http://localhost/api/admin/whatsapp/retry", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
  });

  it("retries failed WhatsApp outbox events for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await POST(new Request("http://localhost/api/admin/whatsapp/retry?limit=10", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", retried: 3 });
    expect(mocks.retryFailedWhatsAppEvents).toHaveBeenCalledWith({
      limit: 10,
      eventIds: [],
      tenantId: TENANT_ID
    });
  });

  it("returns 500 and records failure audit when retry execution throws", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.retryFailedWhatsAppEvents.mockRejectedValueOnce(new Error("rate limited"));

    const response = await POST(
      new Request("http://localhost/api/admin/whatsapp/retry?limit=10", { method: "POST" })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "Failed to retry failed WhatsApp outbox events",
      detail: "rate limited"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "whatsapp_outbox_retry_failed"
      })
    );
  });
});
