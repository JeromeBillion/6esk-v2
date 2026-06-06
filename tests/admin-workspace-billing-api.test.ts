import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbConnect: vi.fn(),
  dbQuery: vi.fn(),
  getSessionUser: vi.fn(),
  isTenantAdmin: vi.fn(),
  getTenantById: vi.fn(),
  getTenantBillingLifecycleSnapshot: vi.fn(),
  encrypt: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    connect: mocks.dbConnect,
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isTenantAdmin: mocks.isTenantAdmin
}));

vi.mock("@/server/tenant/lifecycle", () => ({
  getTenantById: mocks.getTenantById
}));

vi.mock("@/server/security/encryption", () => ({
  encrypt: mocks.encrypt
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/billing/lifecycle", () => ({
  getTenantBillingLifecycleSnapshot: mocks.getTenantBillingLifecycleSnapshot
}));

import { GET } from "@/app/api/admin/workspace/billing/route";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("workspace billing admin API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1",
      tenant_id: TENANT_ID,
      role_name: "tenant_admin"
    });
    mocks.isTenantAdmin.mockReturnValue(true);
    mocks.getTenantById.mockResolvedValue({
      id: TENANT_ID,
      plan: "standard",
      status: "active",
      settings: { aiProviderMode: "managed" }
    });
    mocks.getTenantBillingLifecycleSnapshot.mockResolvedValue({
      tenantId: TENANT_ID,
      estimatedInvoice: { totalCent: 119800 }
    });
  });

  it("returns tenant billing settings with lifecycle invoice visibility", async () => {
    const response = await GET(new Request("http://localhost/api/admin/workspace/billing"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.billingLifecycle).toMatchObject({
      tenantId: TENANT_ID,
      estimatedInvoice: { totalCent: 119800 }
    });
    expect(mocks.getTenantBillingLifecycleSnapshot).toHaveBeenCalledWith({ tenantId: TENANT_ID });
  });
});
