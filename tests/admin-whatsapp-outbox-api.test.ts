import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  deliverPendingWhatsAppEvents: vi.fn(),
  getWhatsAppOutboxMetrics: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/whatsapp/outbox", () => ({
  deliverPendingWhatsAppEvents: mocks.deliverPendingWhatsAppEvents
}));

vi.mock("@/server/whatsapp/outbox-metrics", () => ({
  getWhatsAppOutboxMetrics: mocks.getWhatsAppOutboxMetrics
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST } from "@/app/api/admin/whatsapp/outbox/route";

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

describe("/api/admin/whatsapp/outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WHATSAPP_OUTBOX_SECRET", "wa-secret");
    vi.stubEnv("TENANT_INGRESS_REQUIRE_SECRETS", "false");
    mocks.getWhatsAppOutboxMetrics.mockResolvedValue({
      account: {
        id: "wa-1",
        provider: "meta",
        phoneNumber: "+27820000000",
        status: "active",
        updatedAt: "2026-03-29T10:00:00.000Z"
      },
      queue: {
        queued: 1,
        dueNow: 1,
        processing: 0,
        failed: 1,
        sentTotal: 10,
        sent24h: 2,
        nextAttemptAt: null,
        lastSentAt: null,
        lastFailedAt: null,
        lastError: null
      }
    });
    mocks.deliverPendingWhatsAppEvents.mockResolvedValue({
      delivered: 2,
      skipped: 0
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("GET returns metrics for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.queue).toMatchObject({ queued: 1, failed: 1 });
    expect(mocks.getWhatsAppOutboxMetrics).toHaveBeenCalledWith(TENANT_ID);
  });

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const getResponse = await GET();
    const postResponse = await POST(
      new Request("http://localhost/api/admin/whatsapp/outbox?limit=25", { method: "POST" })
    );

    expect(getResponse.status).toBe(403);
    expect(postResponse.status).toBe(403);
    expect(mocks.getWhatsAppOutboxMetrics).not.toHaveBeenCalled();
    expect(mocks.deliverPendingWhatsAppEvents).not.toHaveBeenCalled();
  });

  it("POST runs WhatsApp outbox and records audit for admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await POST(
      new Request("http://localhost/api/admin/whatsapp/outbox?limit=25", { method: "POST" })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", delivered: 2, skipped: 0 });
    expect(mocks.deliverPendingWhatsAppEvents).toHaveBeenCalledWith({ limit: 25, tenantId: TENANT_ID });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "whatsapp_outbox_triggered",
        data: expect.objectContaining({ authMode: "session" })
      })
    );
  });

  it("requires tenant header for shared-secret callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/whatsapp/outbox?limit=25", {
        method: "POST",
        headers: { "x-6esk-secret": "wa-secret" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Tenant header is required" });
    expect(mocks.deliverPendingWhatsAppEvents).not.toHaveBeenCalled();
  });

  it("runs WhatsApp outbox for shared-secret callers with explicit tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/whatsapp/outbox?limit=8", {
        method: "POST",
        headers: {
          "x-6esk-secret": "wa-secret",
          "x-6esk-tenant-id": TENANT_ID
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.deliverPendingWhatsAppEvents).toHaveBeenCalledWith({ limit: 8, tenantId: TENANT_ID });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: null,
        data: expect.objectContaining({ authMode: "shared_secret" })
      })
    );
  });

  it("POST returns 500 and records failure audit when delivery throws", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.deliverPendingWhatsAppEvents.mockRejectedValueOnce(new Error("meta unavailable"));

    const response = await POST(
      new Request("http://localhost/api/admin/whatsapp/outbox?limit=25", { method: "POST" })
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: "Failed to run WhatsApp outbox",
      detail: "meta unavailable"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "whatsapp_outbox_trigger_failed"
      })
    );
  });
});
