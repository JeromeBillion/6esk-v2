import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  isMfaRequiredForLogin: vi.fn(),
  dbQuery: vi.fn(),
  redactCallData: vi.fn((value) => value),
  getActivePrivilegedAccessGrantForSubject: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionContext: mocks.getSessionContext
}));

vi.mock("@/server/auth/mfa", () => ({
  isMfaRequiredForLogin: mocks.isMfaRequiredForLogin
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: (user: { role_name?: string | null } | null) => user?.role_name === "lead_admin",
  isInternalSupportUser: (user: { role_name?: string | null } | null) =>
    ["internal_support", "support_admin", "break_glass"].includes(user?.role_name ?? ""),
  isPrivilegedRole: (user: { role_name?: string | null } | null) =>
    ["lead_admin", "internal_support", "support_admin", "break_glass"].includes(user?.role_name ?? "")
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/calls/redaction", () => ({
  redactCallData: mocks.redactCallData
}));

vi.mock("@/server/auth/privileged-access", () => ({
  getActivePrivilegedAccessGrantForSubject: mocks.getActivePrivilegedAccessGrantForSubject
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET } from "@/app/api/admin/audit-logs/route";

function buildUser(roleName: "lead_admin" | "agent" | "internal_support") {
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
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password_mfa",
      user: buildUser("lead_admin")
    });
    mocks.isMfaRequiredForLogin.mockResolvedValue(true);
    mocks.recordAuditLog.mockResolvedValue(undefined);
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
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password",
      user: buildUser("agent")
    });

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
    expect(sql).toContain("AND a.workspace_key = $2");
    expect(sql).toContain("u.tenant_key = a.tenant_key");
    expect(sql).toContain("u.workspace_key = a.workspace_key");
    expect(values).toEqual(["tenant-a", "workspace-a", 20]);
  });

  it("allows internal support audit-log reads only with an active support grant", async () => {
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password_mfa",
      user: buildUser("internal_support")
    });
    mocks.getActivePrivilegedAccessGrantForSubject.mockResolvedValue({
      id: "99999999-9999-9999-9999-999999999999",
      tenant_key: "tenant-b",
      workspace_key: "workspace-b",
      access_type: "support",
      status: "active",
      subject_email: "internal_support@example.test",
      reference: "INC-9",
      expires_at: "2026-06-04T01:00:00.000Z",
      metadata: {}
    });

    const response = await GET(
      new Request("http://localhost/api/admin/audit-logs?limit=10", {
        headers: { "x-6esk-privileged-access-grant": "99999999-9999-9999-9999-999999999999" }
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.getActivePrivilegedAccessGrantForSubject).toHaveBeenCalledWith({
      grantId: "99999999-9999-9999-9999-999999999999",
      subjectEmail: "internal_support@example.test",
      accessTypes: ["support", "break_glass"]
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-b",
        workspaceKey: "workspace-b",
        actorUserId: null,
        action: "privileged_access_used",
        entityId: "99999999-9999-9999-9999-999999999999"
      })
    );
    const [, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(values).toEqual(["tenant-b", "workspace-b", 10]);
  });

  it("blocks audit log reads for privileged sessions that have not completed MFA", async () => {
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password_mfa_enrollment_required",
      user: buildUser("lead_admin")
    });

    const response = await GET(new Request("http://localhost/api/admin/audit-logs?limit=20"));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ code: "mfa_enrollment_required" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });
});
