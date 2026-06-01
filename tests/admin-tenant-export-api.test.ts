import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  recordAuditLog: vi.fn(),
  exportTenantDataBundle: vi.fn()
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

vi.mock("@/server/tenant-export", () => ({
  exportTenantDataBundle: mocks.exportTenantDataBundle
}));

import { POST } from "@/app/api/admin/tenant/export/route";

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

describe("admin tenant export API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser("lead_admin"));
    mocks.exportTenantDataBundle.mockResolvedValue({
      formatVersion: "tenant-export.v1",
      exportId: "11111111-1111-1111-1111-111111111111",
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      generatedAt: "2026-05-31T00:00:00.000Z",
      limitPerSection: 25,
      sectionCount: 3,
      totalRows: 12,
      exportedRows: 12,
      redaction: {
        secretsRedacted: true,
        redactedColumnsBySection: {
          users: ["password_hash"]
        }
      },
      objectStorageManifest: [{ key: "tenants/tenant-a/file.txt" }],
      sections: []
    });
  });

  it("blocks non-admin tenant exports", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limitPerSection: 25 })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.exportTenantDataBundle).not.toHaveBeenCalled();
  });

  it("exports only the admin tenant scope and audits without row payloads", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/tenant/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limitPerSection: 25 })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "created",
      export: {
        formatVersion: "tenant-export.v1",
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      }
    });
    expect(mocks.exportTenantDataBundle).toHaveBeenCalledWith(
      {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      },
      {
        limitPerSection: 25
      }
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a",
        actorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        action: "tenant_data_export_created",
        entityType: "tenant_data_export",
        entityId: "11111111-1111-1111-1111-111111111111",
        data: {
          sectionCount: 3,
          totalRows: 12,
          exportedRows: 12,
          objectStorageReferenceCount: 1,
          limitPerSection: 25,
          redactedSections: ["users"]
        }
      })
    );
    expect(mocks.recordAuditLog.mock.calls[0][0].data).not.toHaveProperty("sections");
  });
});
