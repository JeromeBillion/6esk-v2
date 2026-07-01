import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  canManageTickets: vi.fn(),
  checkModuleEntitlement: vi.fn(),
  dbQuery: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  canManageTickets: mocks.canManageTickets
}));

vi.mock("@/server/tenant/module-guard", () => ({
  checkModuleEntitlement: mocks.checkModuleEntitlement
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { GET } from "@/app/api/whatsapp/templates/route";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function buildUser(tenantId: string | null = TENANT_ID) {
  return {
    id: "user-1",
    email: "agent@example.test",
    display_name: "Agent",
    role_id: "role-1",
    role_name: "agent",
    tenant_id: tenantId,
    tenant_slug: "acme",
    real_tenant_id: tenantId ?? "",
    is_impersonating: false
  };
}

describe("GET /api/whatsapp/templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.canManageTickets.mockReturnValue(true);
    mocks.checkModuleEntitlement.mockResolvedValue(true);
    mocks.dbQuery.mockResolvedValue({
      rows: [
        {
          id: "template-1",
          provider: "meta",
          name: "follow_up",
          language: "en_US",
          category: "support",
          status: "active",
          components: []
        }
      ]
    });
  });

  it("rejects users without ticket permissions before template reads", async () => {
    mocks.canManageTickets.mockReturnValue(false);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.checkModuleEntitlement).not.toHaveBeenCalled();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("rejects tenantless sessions before template reads", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser(null));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.checkModuleEntitlement).not.toHaveBeenCalled();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("rejects disabled WhatsApp workspaces before template reads", async () => {
    mocks.checkModuleEntitlement.mockResolvedValue(false);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "module_disabled",
      module: "whatsapp"
    });
    expect(mocks.checkModuleEntitlement).toHaveBeenCalledWith("whatsapp", TENANT_ID);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("lists only active WhatsApp templates for the session tenant", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.templates).toHaveLength(1);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE tenant_id = $1"),
      [TENANT_ID]
    );
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("AND status = 'active'");
  });
});
