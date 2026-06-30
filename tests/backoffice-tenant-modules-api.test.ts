import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  hasPrivilegedMfaSession: vi.fn(),
  getTenantById: vi.fn(),
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  recordAuditLogWithClient: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/auth/privileged-access", () => ({
  hasPrivilegedMfaSession: mocks.hasPrivilegedMfaSession
}));

vi.mock("@/server/tenant/lifecycle", () => ({
  getTenantById: mocks.getTenantById
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

vi.mock("@/server/audit", () => ({
  recordAuditLogWithClient: mocks.recordAuditLogWithClient
}));

import { PATCH } from "@/app/api/backoffice/tenants/[tenantId]/modules/route";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "11111111-1111-4111-8111-111111111111";

function params(tenantId = TENANT_ID) {
  return { params: Promise.resolve({ tenantId }) };
}

function request(body: unknown) {
  return new Request(`http://localhost/api/backoffice/tenants/${TENANT_ID}/modules`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("backoffice tenant modules API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: USER_ID,
      email: "jerome.choma@6ex.co.za",
      role_name: "internal_admin"
    });
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.hasPrivilegedMfaSession.mockReturnValue(true);
    mocks.getTenantById.mockResolvedValue({ id: TENANT_ID, status: "active" });
    mocks.dbConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease
    });
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT modules")) {
        return {
          rows: [
            {
              modules: {
                email: true,
                whatsapp: false,
                voice: false,
                rogueModule: true
              }
            }
          ]
        };
      }
      return { rows: [] };
    });
    mocks.recordAuditLogWithClient.mockResolvedValue(undefined);
  });

  it("rejects non-catalog module keys before tenant entitlement writes", async () => {
    const response = await PATCH(
      request({
        modules: {
          whatsapp: true,
          rogueModule: true
        }
      }),
      params()
    );

    expect(response.status).toBe(400);
    expect(mocks.getTenantById).not.toHaveBeenCalled();
    expect(mocks.dbConnect).not.toHaveBeenCalled();
    expect(mocks.recordAuditLogWithClient).not.toHaveBeenCalled();
  });

  it("strips stale non-catalog modules when persisting a valid update", async () => {
    const response = await PATCH(
      request({
        modules: {
          whatsapp: true
        }
      }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.modules).toMatchObject({
      email: true,
      whatsapp: true,
      voice: false
    });
    expect(body.modules.rogueModule).toBeUndefined();

    const updateCall = mocks.clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE workspace_modules")
    );
    expect(updateCall).toBeDefined();
    const persistedModules = JSON.parse(updateCall?.[1]?.[0] as string);
    expect(persistedModules.rogueModule).toBeUndefined();
    expect(persistedModules.whatsapp).toBe(true);

    const entitlementModuleKeys = mocks.clientQuery.mock.calls
      .filter(([sql]) => String(sql).includes("tenant_entitlements"))
      .map(([, params]) => (params as unknown[])[1]);
    expect(entitlementModuleKeys).not.toContain("rogueModule");
    expect(mocks.recordAuditLogWithClient).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "tenant_modules_updated"
      })
    );
  });
});
