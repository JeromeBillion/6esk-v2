import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  dbQuery: vi.fn(),
  redactCallData: vi.fn((value) => value)
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: (user: { role_name?: string | null } | null) => user?.role_name === "lead_admin"
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/calls/redaction", () => ({
  redactCallData: mocks.redactCallData
}));

import { GET } from "@/app/api/admin/audit-logs/route";

function buildUser(roleName: "lead_admin" | "agent") {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@example.test`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_key: "tenant-a",
    workspace_key: "workspace-a"
  };
}

describe("GET /api/admin/audit-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.dbQuery.mockResolvedValue({
      rows: [
        {
          id: "audit-1",
          action: "ticket_updated",
          entity_type: "ticket",
          entity_id: "ticket-1",
          data: { ok: true },
          created_at: "2026-06-01T00:00:00.000Z",
          actor_name: "Lead",
          actor_email: "lead@example.test"
        }
      ]
    });
  });

  it("blocks non-admin audit log reads", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET(new Request("http://localhost/api/admin/audit-logs"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("scopes audit log reads to the admin tenant", async () => {
    const response = await GET(new Request("http://localhost/api/admin/audit-logs?limit=20"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.logs).toHaveLength(1);
    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("WHERE a.tenant_key = $1");
    expect(sql).toContain("u.tenant_key = a.tenant_key");
    expect(values).toEqual(["tenant-a", 20]);
  });
});
