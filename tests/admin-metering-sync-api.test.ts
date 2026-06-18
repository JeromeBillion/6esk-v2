import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isLeadAdmin: vi.fn(),
  syncPendingMeteringEvents: vi.fn(),
  recordAuditLog: vi.fn(),
  runInBackground: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: mocks.isLeadAdmin
}));

vi.mock("@/server/billing/metering-sync", () => ({
  syncPendingMeteringEvents: mocks.syncPendingMeteringEvents
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/async", () => ({
  runInBackground: mocks.runInBackground
}));

import { POST } from "@/app/api/admin/metering/sync/route";

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

describe("POST /api/admin/metering/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("JOBS_RUNNER_SECRET", "jobs-maintenance-secret");
    vi.stubEnv("TENANT_INGRESS_REQUIRE_SECRETS", "false");
    mocks.isLeadAdmin.mockImplementation((user) => user?.role_name === "lead_admin");
    mocks.syncPendingMeteringEvents.mockResolvedValue({ synced: 2, failed: 0 });
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires a tenant header for shared-secret callers", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/metering/sync", {
        method: "POST",
        headers: { "x-6esk-secret": "jobs-maintenance-secret" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Tenant header is required" });
    expect(mocks.syncPendingMeteringEvents).not.toHaveBeenCalled();
  });

  it("syncs metering events under the explicit machine tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/admin/metering/sync?limit=6", {
        method: "POST",
        headers: {
          "x-6esk-secret": "jobs-maintenance-secret",
          "x-6esk-tenant-id": TENANT_ID
        }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", synced: 2, failed: 0 });
    expect(mocks.syncPendingMeteringEvents).toHaveBeenCalledWith({
      limit: 6,
      tenantId: TENANT_ID
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: null,
        action: "metering_sync_triggered",
        data: expect.objectContaining({ authMode: "shared_secret", synced: 2 })
      })
    );
  });

  it("syncs metering events under the lead admin session tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));

    const response = await POST(
      new Request("http://localhost/api/admin/metering/sync?limit=12", {
        method: "POST"
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.syncPendingMeteringEvents).toHaveBeenCalledWith({
      limit: 12,
      tenantId: TENANT_ID
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        action: "metering_sync_triggered",
        data: expect.objectContaining({ authMode: "session" })
      })
    );
  });

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const response = await POST(
      new Request("http://localhost/api/admin/metering/sync", {
        method: "POST"
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.syncPendingMeteringEvents).not.toHaveBeenCalled();
  });
});
