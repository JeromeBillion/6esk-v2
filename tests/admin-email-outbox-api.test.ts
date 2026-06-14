import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isLeadAdmin: vi.fn(),
  deliverPendingEmailOutboxEvents: vi.fn(),
  getEmailOutboxMetrics: vi.fn(),
  recordAuditLog: vi.fn(),
  runInBackground: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: mocks.isLeadAdmin
}));

vi.mock("@/server/email/outbox", () => ({
  deliverPendingEmailOutboxEvents: mocks.deliverPendingEmailOutboxEvents,
  getEmailOutboxMetrics: mocks.getEmailOutboxMetrics
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/async", () => ({
  runInBackground: mocks.runInBackground
}));

import { GET, POST } from "@/app/api/admin/email/outbox/route";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";

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

describe("GET/POST /api/admin/email/outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INBOUND_SHARED_SECRET", "email-maintenance-secret");
    vi.stubEnv("TENANT_INGRESS_REQUIRE_SECRETS", "false");
    mocks.isLeadAdmin.mockImplementation((user) => user?.role_name === "lead_admin");
    mocks.getEmailOutboxMetrics.mockResolvedValue({ queue: { queued: 1 } });
    mocks.deliverPendingEmailOutboxEvents.mockResolvedValue({ delivered: 1, skipped: 0 });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns metrics for the lead admin tenant only", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ queue: { queued: 1 } });
    expect(mocks.getEmailOutboxMetrics).toHaveBeenCalledWith(TENANT_ID);
  });

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const getResponse = await GET();
    const postResponse = await POST(new Request("http://localhost/api/admin/email/outbox", { method: "POST" }));

    expect(getResponse.status).toBe(403);
    expect(postResponse.status).toBe(403);
    expect(mocks.getEmailOutboxMetrics).not.toHaveBeenCalled();
    expect(mocks.deliverPendingEmailOutboxEvents).not.toHaveBeenCalled();
  });

  it("requires a tenant header for shared-secret callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/email/outbox", {
        method: "POST",
        headers: { "x-6esk-secret": "email-maintenance-secret" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Tenant header is required" });
    expect(mocks.deliverPendingEmailOutboxEvents).not.toHaveBeenCalled();
  });

  it("delivers email outbox events under the explicit machine tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/email/outbox?limit=6", {
        method: "POST",
        headers: {
          "x-6esk-secret": "email-maintenance-secret",
          "x-6esk-tenant-id": TENANT_ID
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.deliverPendingEmailOutboxEvents).toHaveBeenCalledWith({
      limit: 6,
      tenantId: TENANT_ID
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: null,
        action: "email_outbox_triggered",
        data: expect.objectContaining({ authMode: "shared_secret", delivered: 1 })
      })
    );
  });
});
