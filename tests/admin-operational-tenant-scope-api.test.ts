import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "99999999-9999-4999-8999-999999999999";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isLeadAdmin: vi.fn(),
  isInternalStaff: vi.fn(),
  dbQuery: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: mocks.isLeadAdmin,
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { GET as getAdminAuditLogs } from "@/app/api/admin/audit-logs/route";
import { GET as getAdminSecurity } from "@/app/api/admin/security/route";
import { GET as getAdminSpamMessages } from "@/app/api/admin/spam-messages/route";
import { GET as getBackofficeAuditLogs } from "@/app/api/backoffice/audit-logs/route";

function buildUser(roleName = "lead_admin", tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: `${roleName}@example.com`,
    display_name: roleName,
    role_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role_name: roleName,
    tenant_id: tenantId
  };
}

describe("admin operational route tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.isLeadAdmin.mockReturnValue(true);
    mocks.isInternalStaff.mockReturnValue(false);
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  it("rejects tenantless admin sessions before sensitive operational reads", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin", null));

    const audit = await getAdminAuditLogs(new Request("http://localhost/api/admin/audit-logs"));
    const security = await getAdminSecurity(new Request("http://localhost/api/admin/security"));
    const spam = await getAdminSpamMessages(new Request("http://localhost/api/admin/spam-messages"));

    expect(audit.status).toBe(403);
    expect(security.status).toBe(403);
    expect(spam.status).toBe(403);
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("scopes tenant-admin audit log reads to the session tenant", async () => {
    await getAdminAuditLogs(new Request("http://localhost/api/admin/audit-logs?limit=25"));

    const [sql, values] = mocks.dbQuery.mock.calls[0];
    expect(sql).toContain("WHERE a.tenant_id = $1");
    expect(sql).toContain("u.tenant_id = a.tenant_id");
    expect(values).toEqual([TENANT_ID, 25]);
  });

  it("scopes tenant-admin security inventory to the session tenant", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({ rows: [{ total: 1, encrypted: 1 }] })
      .mockResolvedValueOnce({ rows: [{ total_tokens: 1, encrypted_tokens: 1, missing_tokens: 0 }] });

    await getAdminSecurity(new Request("http://localhost/api/admin/security"));

    expect(mocks.dbQuery).toHaveBeenCalledTimes(2);
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("FROM agent_integrations");
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("WHERE tenant_id = $1");
    expect(mocks.dbQuery.mock.calls[0][1]).toEqual([TENANT_ID]);
    expect(mocks.dbQuery.mock.calls[1][0]).toContain("FROM whatsapp_accounts");
    expect(mocks.dbQuery.mock.calls[1][0]).toContain("WHERE tenant_id = $1");
    expect(mocks.dbQuery.mock.calls[1][1]).toEqual([TENANT_ID]);
  });

  it("scopes spam message reads to the session tenant", async () => {
    await getAdminSpamMessages(new Request("http://localhost/api/admin/spam-messages?limit=10"));

    const [sql, values] = mocks.dbQuery.mock.calls[0];
    expect(sql).toContain("m.tenant_id = $1");
    expect(sql).toContain("mb.tenant_id = m.tenant_id");
    expect(values).toEqual([TENANT_ID, 10]);
  });

  it("marks internal global backoffice audit reads as intentionally global", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("internal_admin", null));
    mocks.isInternalStaff.mockReturnValue(true);

    await getBackofficeAuditLogs(
      new Request("http://localhost/api/backoffice/audit-logs?entityType=ticket&limit=10&offset=5")
    );

    const [sql, values] = mocks.dbQuery.mock.calls[0];
    expect(sql).toContain("tenant-query-guard: ignore internal-backoffice-global-audit-log-view");
    expect(sql).not.toContain("tenant_id = $1");
    expect(values).toEqual(["ticket", 10, 5]);
  });

  it("keeps internal tenant-filtered backoffice audit reads explicitly scoped", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("internal_admin", null));
    mocks.isInternalStaff.mockReturnValue(true);

    await getBackofficeAuditLogs(
      new Request(`http://localhost/api/backoffice/audit-logs?tenantId=${TENANT_ID}&limit=10`)
    );

    const [sql, values] = mocks.dbQuery.mock.calls[0];
    expect(sql).not.toContain("tenant-query-guard: ignore");
    expect(sql).toContain("tenant_id = $1");
    expect(values).toEqual([TENANT_ID, 10, 0]);
  });
});
