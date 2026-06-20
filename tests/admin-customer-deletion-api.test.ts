import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "99999999-9999-4999-8999-999999999999";
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  hasTenantAdminAccess: vi.fn(),
  deleteCustomerAndData: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  hasTenantAdminAccess: mocks.hasTenantAdminAccess
}));

vi.mock("@/server/customers", () => ({
  deleteCustomerAndData: mocks.deleteCustomerAndData
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { DELETE } from "@/app/api/admin/customers/[customerId]/route";

function buildUser(tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "admin@example.com",
    display_name: "Admin",
    role_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role_name: "tenant_admin",
    tenant_id: tenantId
  };
}

describe("DELETE /api/admin/customers/[customerId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DATA_SUBJECT_DELETION_ENABLED", "false");
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.hasTenantAdminAccess.mockReturnValue(true);
    mocks.deleteCustomerAndData.mockResolvedValue(true);
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled by default before any destructive erasure work runs", async () => {
    const response = await DELETE(
      new Request(`http://localhost/api/admin/customers/${CUSTOMER_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ customerId: CUSTOMER_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(501);
    expect(body).toMatchObject({ code: "data_subject_deletion_disabled" });
    expect(mocks.deleteCustomerAndData).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
  });

  it("rejects tenantless admin sessions before the deletion feature flag is checked", async () => {
    vi.stubEnv("DATA_SUBJECT_DELETION_ENABLED", "true");
    mocks.getSessionUser.mockResolvedValue(buildUser(null));

    const response = await DELETE(
      new Request(`http://localhost/api/admin/customers/${CUSTOMER_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ customerId: CUSTOMER_ID }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.deleteCustomerAndData).not.toHaveBeenCalled();
  });

  it("uses the session tenant when explicitly enabled outside production", async () => {
    vi.stubEnv("DATA_SUBJECT_DELETION_ENABLED", "true");

    const response = await DELETE(
      new Request(`http://localhost/api/admin/customers/${CUSTOMER_ID}`, { method: "DELETE" }),
      { params: Promise.resolve({ customerId: CUSTOMER_ID }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.deleteCustomerAndData).toHaveBeenCalledWith(CUSTOMER_ID, TENANT_ID);
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        action: "data_subject_erasure"
      })
    );
  });
});
