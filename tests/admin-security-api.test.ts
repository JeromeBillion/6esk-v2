import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { GET } from "@/app/api/admin/security/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@example.test`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_key: "tenant-sec",
    workspace_key: "workspace-sec"
  };
}

describe("GET /api/admin/security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_IP_ALLOWLIST;
    delete process.env.AGENT_IP_ALLOWLIST;
    delete process.env.AGENT_SECRET_KEY;
    delete process.env.INBOUND_SHARED_SECRET;
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/security"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("scopes security posture aggregates to the admin workspace", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ total: 3, encrypted: 2 }] })
      .mockResolvedValueOnce({
        rows: [{ total_tokens: 4, encrypted_tokens: 3, missing_tokens: 1 }]
      });

    const response = await GET(
      new Request("http://localhost/api/admin/security", {
        headers: { "x-forwarded-for": "203.0.113.10, 198.51.100.20" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      clientIp: "203.0.113.10",
      agentIntegrationStats: { total: 3, encrypted: 2, unencrypted: 1 },
      whatsappTokenStats: { total: 4, encrypted: 3, unencrypted: 1, missing: 1 }
    });

    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("WHERE tenant_key = $1"),
      ["tenant-sec", "workspace-sec"]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("AND workspace_key = $2"),
      ["tenant-sec", "workspace-sec"]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("FROM whatsapp_accounts"),
      ["tenant-sec", "workspace-sec"]
    );
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND workspace_key = $2"),
      ["tenant-sec", "workspace-sec"]
    );
  });
});
