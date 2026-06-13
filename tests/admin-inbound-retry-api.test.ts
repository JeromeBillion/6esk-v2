import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  retryFailedInboundEvents: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/email/inbound-retry", () => ({
  retryFailedInboundEvents: mocks.retryFailedInboundEvents
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/admin/inbound/retry/route";

const ORIGINAL_ENV = { ...process.env };
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

describe("POST /api/admin/inbound/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INBOUND_SHARED_SECRET = "inbound-retry-secret";
    mocks.retryFailedInboundEvents.mockResolvedValue({
      requested: 2,
      retried: 1,
      failed: 1,
      ids: ["event-1"]
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns 401 for non-admin users without valid secret", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await POST(new Request("http://localhost/api/admin/inbound/retry", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.retryFailedInboundEvents).not.toHaveBeenCalled();
  });

  it("retries events under the lead admin tenant", async () => {
    const admin = buildUser("lead_admin");
    mocks.getSessionUser.mockResolvedValue(admin);

    const response = await POST(
      new Request("http://localhost/api/admin/inbound/retry?limit=25", {
        method: "POST",
        body: JSON.stringify({ eventIds: [" event-1 ", "event-2"] })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", retried: 1, failed: 1 });
    expect(mocks.retryFailedInboundEvents).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      limit: 25,
      eventIds: ["event-1", "event-2"]
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: admin.id,
        action: "inbound_retry_triggered"
      })
    );
  });

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const response = await POST(new Request("http://localhost/api/admin/inbound/retry", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.retryFailedInboundEvents).not.toHaveBeenCalled();
  });

  it("requires a tenant header for shared-secret callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/inbound/retry", {
        method: "POST",
        headers: { "x-6esk-secret": "inbound-retry-secret" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Tenant header is required" });
    expect(mocks.retryFailedInboundEvents).not.toHaveBeenCalled();
  });

  it("allows shared-secret callers with an explicit tenant header", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/inbound/retry?limit=6", {
        method: "POST",
        headers: {
          "x-6esk-secret": "inbound-retry-secret",
          "x-6esk-tenant-id": TENANT_ID
        }
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.retryFailedInboundEvents).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      limit: 6,
      eventIds: []
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: null,
        data: expect.objectContaining({ authMode: "shared_secret" })
      })
    );
  });
});
