import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isLeadAdmin: vi.fn(),
  dbQuery: vi.fn(),
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

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST } from "@/app/api/admin/mailboxes/route";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@6ex.co.za`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: TENANT_ID
  };
}

describe("admin mailboxes API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQuery.mockReset();
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("GET blocks non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));
    mocks.isLeadAdmin.mockReturnValue(false);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
  });

  it("GET returns mailbox records for lead admins", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.isLeadAdmin.mockReturnValue(true);
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "mailbox-1",
          address: "support@6ex.co.za",
          type: "platform",
          created_at: "2026-04-03T12:00:00.000Z",
          owner_email: null,
          members: [{ id: "user-1", email: "agent@6ex.co.za", displayName: "Agent", accessLevel: "member" }]
        }
      ]
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mailboxes).toHaveLength(1);
    expect(body.mailboxes[0]).toMatchObject({
      address: "support@6ex.co.za",
      type: "platform"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE m.tenant_id = $1"), [
      TENANT_ID
    ]);
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("owner.tenant_id = m.tenant_id");
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("member.tenant_id = m.tenant_id");
  });

  it("GET rejects admin-looking sessions without tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue({ ...buildUser("lead_admin"), tenant_id: "" });
    mocks.isLeadAdmin.mockReturnValue(true);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("POST upserts a platform mailbox and replaces memberships", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.isLeadAdmin.mockReturnValue(true);
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { id: "user-1", email: "agent1@6ex.co.za", display_name: "Agent One" },
          { id: "user-2", email: "agent2@6ex.co.za", display_name: "Agent Two" }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "mailbox-1",
            address: "support@6ex.co.za",
            type: "platform",
            created_at: "2026-04-03T12:00:00.000Z"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await POST(
      new Request("http://localhost/api/admin/mailboxes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: "support@6ex.co.za",
          memberEmails: ["agent1@6ex.co.za", "agent2@6ex.co.za"]
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "created",
      mailbox: {
        address: "support@6ex.co.za",
        type: "platform"
      }
    });
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("tenant_id = $2"),
      ["support@6ex.co.za", TENANT_ID]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND tenant_id = $2"),
      [["agent1@6ex.co.za", "agent2@6ex.co.za"], TENANT_ID]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("m.tenant_id = $2"),
      ["mailbox-1", TENANT_ID]
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        action: "mailbox_created",
        entityType: "mailbox",
        entityId: "mailbox-1"
      })
    );
  });

  it("POST rejects cross-tenant mailbox address conflicts", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.isLeadAdmin.mockReturnValue(true);
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await POST(
      new Request("http://localhost/api/admin/mailboxes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: "support@6ex.co.za",
          memberEmails: []
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: "Mailbox address belongs to another tenant" });
  });

  it("POST rejects unknown member emails", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.isLeadAdmin.mockReturnValue(true);
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: "user-1", email: "agent1@6ex.co.za", display_name: "Agent One" }]
      });

    const response = await POST(
      new Request("http://localhost/api/admin/mailboxes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: "support@6ex.co.za",
          memberEmails: ["agent1@6ex.co.za", "missing@6ex.co.za"]
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: "Some member emails do not match existing users.",
      code: "unknown_mailbox_members",
      missingMembers: ["missing@6ex.co.za"]
    });
  });
});
