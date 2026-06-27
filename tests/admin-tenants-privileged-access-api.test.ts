import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireBackofficeStaff: vi.fn(),
  requireBackofficeSensitiveAccess: vi.fn(),
  isDemoModeEnabled: vi.fn(),
  listTenants: vi.fn(),
  provisionTenant: vi.fn(),
  suspendTenant: vi.fn(),
  reactivateTenant: vi.fn(),
  closeTenant: vi.fn(),
  changeTenantPlan: vi.fn()
}));

vi.mock("@/server/backoffice/authz", () => ({
  requireBackofficeStaff: mocks.requireBackofficeStaff,
  requireBackofficeSensitiveAccess: mocks.requireBackofficeSensitiveAccess
}));

vi.mock("@/app/lib/demo-mode", () => ({
  isDemoModeEnabled: mocks.isDemoModeEnabled
}));

vi.mock("@/server/tenant", () => ({
  listTenants: mocks.listTenants,
  provisionTenant: mocks.provisionTenant,
  suspendTenant: mocks.suspendTenant,
  reactivateTenant: mocks.reactivateTenant,
  closeTenant: mocks.closeTenant,
  changeTenantPlan: mocks.changeTenantPlan,
  TenantLifecycleError: class TenantLifecycleError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly status = 400
    ) {
      super(message);
    }
  }
}));

import { GET, PATCH, POST } from "@/app/api/admin/tenants/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

function staffAuth() {
  return {
    ok: true,
    user: {
      id: USER_ID,
      role_name: "internal_admin",
      tenant_id: "33333333-3333-4333-8333-333333333333"
    }
  };
}

function deniedAuth() {
  return {
    ok: false,
    response: Response.json({ error: "MFA is required for sensitive 6esk Work actions." }, { status: 403 })
  };
}

describe("legacy admin tenant API privileged access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoModeEnabled.mockReturnValue(false);
    mocks.requireBackofficeStaff.mockResolvedValue(staffAuth());
    mocks.requireBackofficeSensitiveAccess.mockResolvedValue(staffAuth());
    mocks.listTenants.mockResolvedValue([]);
    mocks.provisionTenant.mockResolvedValue({ id: TENANT_ID, slug: "acme" });
  });

  it("allows staff to list tenants without requiring sensitive access", async () => {
    const response = await GET(new Request("http://localhost/api/admin/tenants?status=active"));

    expect(response.status).toBe(200);
    expect(mocks.requireBackofficeStaff).toHaveBeenCalled();
    expect(mocks.requireBackofficeSensitiveAccess).not.toHaveBeenCalled();
    expect(mocks.listTenants).toHaveBeenCalledWith({ status: "active" });
  });

  it("requires sensitive access before provisioning tenants", async () => {
    mocks.requireBackofficeSensitiveAccess.mockResolvedValueOnce(deniedAuth());

    const response = await POST(
      new Request("http://localhost/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({ slug: "acme", displayName: "Acme", plan: "starter" })
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.provisionTenant).not.toHaveBeenCalled();
  });

  it("passes the privileged actor into tenant provisioning", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/tenants", {
        method: "POST",
        body: JSON.stringify({ slug: "acme", displayName: "Acme", plan: "professional" })
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.provisionTenant).toHaveBeenCalledWith({
      slug: "acme",
      displayName: "Acme",
      plan: "professional",
      actorUserId: USER_ID
    });
  });

  it("requires sensitive access before tenant lifecycle changes", async () => {
    mocks.requireBackofficeSensitiveAccess.mockResolvedValueOnce(deniedAuth());

    const response = await PATCH(
      new Request("http://localhost/api/admin/tenants", {
        method: "PATCH",
        body: JSON.stringify({ tenantId: TENANT_ID, action: "suspend", reason: "billing overdue" })
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.suspendTenant).not.toHaveBeenCalled();
  });

  it("passes the privileged actor into tenant lifecycle changes", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/admin/tenants", {
        method: "PATCH",
        body: JSON.stringify({
          tenantId: TENANT_ID,
          action: "change_plan",
          plan: "enterprise",
          reason: "contract upgrade"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.changeTenantPlan).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      plan: "enterprise",
      reason: "contract upgrade",
      actorUserId: USER_ID
    });
  });
});
