import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isLeadAdmin: vi.fn(),
  dbQuery: vi.fn(),
  decryptSecret: vi.fn(),
  encryptSecret: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: mocks.isLeadAdmin
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/agents/secret", () => ({
  decryptSecret: mocks.decryptSecret,
  encryptSecret: mocks.encryptSecret
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST } from "@/app/api/admin/whatsapp/route";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function buildUser(tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "admin@6ex.co.za",
    display_name: "Admin",
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: "lead_admin",
    tenant_id: tenantId
  };
}

describe("GET/POST /api/admin/whatsapp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLeadAdmin.mockImplementation((user) => user?.role_name === "lead_admin");
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.decryptSecret.mockReturnValue("plain-token");
    mocks.encryptSecret.mockReturnValue("encrypted-token");
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns account settings for the session tenant", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "wa-account-1",
          provider: "meta",
          phone_number: "+27820000000",
          waba_id: "waba-1",
          access_token: "encrypted-token",
          verify_token: "verify",
          status: "active",
          created_at: new Date("2026-01-01T00:00:00.000Z"),
          updated_at: new Date("2026-01-02T00:00:00.000Z")
        }
      ],
      rowCount: 1
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.account).toMatchObject({ id: "wa-account-1", accessToken: "plain-token" });
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE tenant_id = $1"), [TENANT_ID]);
  });

  it("returns 403 when a lead admin session has no tenant", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser(null));

    const getResponse = await GET();
    const postResponse = await POST(
      new Request("http://localhost/api/admin/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "meta",
          phoneNumber: "+27820000000",
          status: "active"
        })
      })
    );

    expect(getResponse.status).toBe(403);
    expect(postResponse.status).toBe(403);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("saves account settings under the session tenant", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: "wa-account-1" }], rowCount: 1 });

    const response = await POST(
      new Request("http://localhost/api/admin/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "meta",
          phoneNumber: "+27820000000",
          accessToken: "plain-token",
          status: "active"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO whatsapp_accounts"),
      expect.arrayContaining([TENANT_ID])
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "whatsapp_account_created"
      })
    );
  });
});
