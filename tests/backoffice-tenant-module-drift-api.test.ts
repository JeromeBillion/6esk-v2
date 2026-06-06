import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  getTenantById: vi.fn(),
  getTenantEntitlementDrift: vi.fn(),
  repairTenantEntitlementDrift: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/tenant/lifecycle", () => ({
  getTenantById: mocks.getTenantById
}));

vi.mock("@/server/tenant/entitlement-drift", () => ({
  getTenantEntitlementDrift: mocks.getTenantEntitlementDrift,
  repairTenantEntitlementDrift: mocks.repairTenantEntitlementDrift
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST } from "@/app/api/backoffice/tenants/[tenantId]/modules/drift/route";

function params(tenantId: string) {
  return { params: Promise.resolve({ tenantId }) };
}

function buildUser() {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    role_name: "internal_support",
    tenant_id: "22222222-2222-2222-2222-222222222222"
  };
}

describe("backoffice tenant module drift API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("rejects non-internal users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.isInternalStaff.mockReturnValue(false);

    const response = await GET(
      new Request("http://localhost/api/backoffice/tenants/t1/modules/drift"),
      params("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    );

    expect(response.status).toBe(403);
  });

  it("returns entitlement drift report", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.getTenantById.mockResolvedValue({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    mocks.getTenantEntitlementDrift.mockResolvedValue({
      tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      workspaceKey: "primary",
      checkedAt: "2026-05-17T00:00:00.000Z",
      drift: [{ moduleKey: "voice", workspaceEnabled: true, entitlementEnabled: false }]
    });

    const response = await GET(
      new Request("http://localhost/api/backoffice/tenants/t1/modules/drift"),
      params("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.driftCount).toBe(1);
    expect(mocks.getTenantEntitlementDrift).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    );
  });

  it("repairs entitlement drift and writes audit log", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.getTenantById.mockResolvedValue({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    mocks.repairTenantEntitlementDrift.mockResolvedValue({
      repaired: 2,
      report: {
        tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        workspaceKey: "primary",
        checkedAt: "2026-05-17T00:00:00.000Z",
        drift: [
          { moduleKey: "voice", workspaceEnabled: true, entitlementEnabled: false },
          { moduleKey: "aiAutomation", workspaceEnabled: false, entitlementEnabled: true }
        ]
      }
    });

    const response = await POST(
      new Request("http://localhost/api/backoffice/tenants/t1/modules/drift", {
        method: "POST"
      }),
      params("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "ok", repaired: 2, driftCount: 2 });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant_entitlement_drift_repaired",
        entityId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
      })
    );
  });
});
