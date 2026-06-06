import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  getTenantById: vi.fn(),
  suspendTenant: vi.fn(),
  reactivateTenant: vi.fn(),
  closeTenant: vi.fn(),
  changeTenantPlan: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/tenant/lifecycle", () => ({
  getTenantById: mocks.getTenantById,
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

import { GET, POST } from "@/app/api/backoffice/tenants/[tenantId]/route";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "11111111-1111-1111-1111-111111111111";

function params(tenantId = TENANT_ID) {
  return { params: Promise.resolve({ tenantId }) };
}

function buildUser() {
  return {
    id: USER_ID,
    role_name: "internal_admin",
    tenant_id: "22222222-2222-2222-2222-222222222222"
  };
}

function tenant(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT_ID,
    slug: "acme",
    displayName: "Acme",
    status: "active",
    plan: "standard",
    settings: {},
    ...overrides
  };
}

describe("backoffice tenant lifecycle API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.getTenantById.mockResolvedValue(tenant());
  });

  it("rejects non-internal users", async () => {
    mocks.isInternalStaff.mockReturnValue(false);

    const response = await GET(
      new Request(`http://localhost/api/backoffice/tenants/${TENANT_ID}`),
      params()
    );

    expect(response.status).toBe(403);
  });

  it("returns tenant lifecycle state", async () => {
    const response = await GET(
      new Request(`http://localhost/api/backoffice/tenants/${TENANT_ID}`),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tenant).toMatchObject({ id: TENANT_ID, status: "active" });
    expect(mocks.getTenantById).toHaveBeenCalledWith(TENANT_ID);
  });

  it("suspends tenants through the lifecycle service", async () => {
    const response = await POST(
      new Request(`http://localhost/api/backoffice/tenants/${TENANT_ID}`, {
        method: "POST",
        body: JSON.stringify({ action: "suspend", reason: "billing overdue" })
      }),
      params()
    );

    expect(response.status).toBe(200);
    expect(mocks.suspendTenant).toHaveBeenCalledWith(TENANT_ID, "billing overdue", USER_ID);
  });

  it("changes tenant plan through the lifecycle service", async () => {
    const response = await POST(
      new Request(`http://localhost/api/backoffice/tenants/${TENANT_ID}`, {
        method: "POST",
        body: JSON.stringify({
          action: "change_plan",
          plan: "enterprise",
          reason: "contract upgrade"
        })
      }),
      params()
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
