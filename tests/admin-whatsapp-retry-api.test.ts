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

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function buildUser(roleName: "lead_admin" | "agent", tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: tenantId
  };
}

describe("POST /api/admin/whatsapp/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WHATSAPP_OUTBOX_SECRET", "wa-secret");
    vi.stubEnv("TENANT_INGRESS_REQUIRE_SECRETS", "false");
    mocks.retryFailedWhatsAppEvents.mockResolvedValue({
      requested: 10,
      retried: 3,
      ids: ["a", "b", "c"]
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const response = await POST(new Request("http://localhost/api/admin/whatsapp/retry", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.retryFailedWhatsAppEvents).not.toHaveBeenCalled();
  });

  it("requires tenant header for shared-secret callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/whatsapp/retry", {
        method: "POST",
        headers: { "x-6esk-secret": "wa-secret" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Tenant header is required" });
    expect(mocks.retryFailedWhatsAppEvents).not.toHaveBeenCalled();
  });

  it("retries failed events for shared-secret callers with explicit tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/whatsapp/retry?limit=7", {
        method: "POST",
        headers: {
          "x-6esk-secret": "wa-secret",
          "x-6esk-tenant-id": TENANT_ID
        },
        body: JSON.stringify({ eventIds: [" wa-1 "] })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.retryFailedWhatsAppEvents).toHaveBeenCalledWith({
      limit: 7,
      eventIds: ["wa-1"],
      tenantId: TENANT_ID
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: null,
        data: expect.objectContaining({ authMode: "shared_secret" })
      })
    );
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
