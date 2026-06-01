import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAuditLog: vi.fn(),
  runTenantIsolationAudit: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: (user: { role_name?: string | null } | null) => user?.role_name === "lead_admin"
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/tenant-isolation-audit", () => ({
  runTenantIsolationAudit: mocks.runTenantIsolationAudit
}));

import { POST } from "@/app/api/admin/tenant/isolation-audit/route";

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

describe("admin tenant isolation audit API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.runTenantIsolationAudit.mockResolvedValue({
      formatVersion: "tenant-isolation-audit.v1",
      reportId: "11111111-1111-1111-1111-111111111111",
      generatedAt: "2026-05-31T00:00:00.000Z",
      mode: "external_launch",
      ready: false,
      blockerCount: 1,
      warningCount: 0,
      infoCount: 0,
      evaluatedCheckCount: 120,
      failedCheckCount: 1,
      passedCheckCount: 119,
      sampleLimit: 5,
      checks: [
        {
          key: "users.missing_scope",
          tableName: "users",
          check: "missing_scope",
          severity: "blocker",
          count: 1,
          sampleIds: ["user-1"],
          description: "users has rows without a complete tenant/workspace key."
        }
      ],
      summary: {
        missingScopeRows: 1,
        orphanTenantRows: 0,
        orphanWorkspaceRows: 0,
        orphanParentRows: 0,
        crossTenantReferenceRows: 0,
        primaryBridgeRows: 0,
        unscopedIdentityRows: 0
      }
    });
  });

  it("blocks non-admin audit access", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/isolation-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "external_launch" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.runTenantIsolationAudit).not.toHaveBeenCalled();
  });

  it("runs a lead-admin audit and logs summary evidence only", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/tenant/isolation-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "external_launch", sampleLimit: 5, includePassed: false })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "created",
      report: {
        formatVersion: "tenant-isolation-audit.v1",
        mode: "external_launch",
        ready: false
      }
    });
    expect(mocks.runTenantIsolationAudit).toHaveBeenCalledWith({
      mode: "external_launch",
      sampleLimit: 5,
      includePassed: false
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        action: "tenant_isolation_audit_generated",
        entityType: "tenant_isolation_audit",
        entityId: "11111111-1111-1111-1111-111111111111",
        data: {
          mode: "external_launch",
          ready: false,
          blockerCount: 1,
          warningCount: 0,
          infoCount: 0,
          evaluatedCheckCount: 120,
          failedCheckCount: 1,
          passedCheckCount: 119,
          sampleLimit: 5,
          summary: {
            missingScopeRows: 1,
            orphanTenantRows: 0,
            orphanWorkspaceRows: 0,
            orphanParentRows: 0,
            crossTenantReferenceRows: 0,
            primaryBridgeRows: 0,
            unscopedIdentityRows: 0
          }
        }
      })
    );
    expect(mocks.recordAuditLog.mock.calls[0][0].data).not.toHaveProperty("checks");
  });

  it("rejects invalid audit payloads", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/tenant/isolation-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "unsafe" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Invalid payload" });
    expect(mocks.runTenantIsolationAudit).not.toHaveBeenCalled();
  });
});
