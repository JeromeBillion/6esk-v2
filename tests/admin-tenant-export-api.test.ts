import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  isMfaRequiredForLogin: vi.fn(),
  recordAuditLog: vi.fn(),
  exportTenantDataBundle: vi.fn(),
  getActivePrivilegedAccessGrantForSubject: vi.fn()
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

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/tenant-export", () => ({
  exportTenantDataBundle: mocks.exportTenantDataBundle
}));

vi.mock("@/server/auth/privileged-access", () => ({
  getActivePrivilegedAccessGrantForSubject: mocks.getActivePrivilegedAccessGrantForSubject
}));

import { POST } from "@/app/api/admin/tenant/export/route";

function buildUser(roleName: "lead_admin" | "agent" | "internal_support" | "break_glass") {
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
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password_mfa",
      user: buildUser("lead_admin")
    });
    mocks.isMfaRequiredForLogin.mockResolvedValue(true);
    mocks.recordAuditLog.mockResolvedValue(undefined);
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
      objectStoragePayloads: [],
      objectStoragePayloadSkips: [],
      objectStoragePayloadSummary: {
        requested: false,
        included: 0,
        skipped: 0,
        maxBytesPerObject: 2 * 1024 * 1024
      },
      sections: []
    });
  });

  it("blocks non-admin tenant exports", async () => {
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password",
      user: buildUser("agent")
    });

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

  it("allows internal support tenant exports only with an active break-glass grant", async () => {
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password_mfa",
      user: buildUser("internal_support")
    });
    mocks.getActivePrivilegedAccessGrantForSubject.mockResolvedValue({
      id: "99999999-9999-9999-9999-999999999999",
      tenant_key: "tenant-b",
      workspace_key: "workspace-b",
      access_type: "break_glass",
      status: "active",
      subject_email: "internal_support@example.test",
      subject_name: "Support",
      reason: "Emergency export",
      reference: "INC-9",
      requested_duration_minutes: 30,
      expires_at: "2026-06-04T01:00:00.000Z",
      metadata: {}
    });

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/export", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-6esk-privileged-access-grant": "99999999-9999-9999-9999-999999999999"
        },
        body: JSON.stringify({ limitPerSection: 10 })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.getActivePrivilegedAccessGrantForSubject).toHaveBeenCalledWith({
      grantId: "99999999-9999-9999-9999-999999999999",
      subjectEmail: "internal_support@example.test",
      accessTypes: ["break_glass"]
    });
    expect(mocks.exportTenantDataBundle).toHaveBeenCalledWith(
      { tenantKey: "tenant-b", workspaceKey: "workspace-b" },
      { limitPerSection: 10 }
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-b",
        workspaceKey: "workspace-b",
        actorUserId: null,
        action: "privileged_access_used",
        entityId: "99999999-9999-9999-9999-999999999999"
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-b",
        workspaceKey: "workspace-b",
        actorUserId: null,
        action: "tenant_data_export_created",
        data: expect.objectContaining({
          accessMode: "privileged_access",
          privilegedAccessGrantId: "99999999-9999-9999-9999-999999999999"
        })
      })
    );
  });

  it("blocks exports for privileged sessions that have not completed MFA", async () => {
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password_mfa_enrollment_required",
      user: buildUser("lead_admin")
    });

    const response = await POST(
      new Request("http://localhost/api/admin/tenant/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limitPerSection: 25 })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ code: "mfa_enrollment_required" });
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
          objectStoragePayloadSummary: {
            requested: false,
            included: 0,
            skipped: 0,
            maxBytesPerObject: 2 * 1024 * 1024
          },
          limitPerSection: 25,
          redactedSections: ["users"],
          accessMode: "tenant_admin",
          privilegedAccessGrantId: null
        }
      })
    );
    expect(mocks.recordAuditLog.mock.calls[0][0].data).not.toHaveProperty("sections");
  });

  it("passes explicit object payload export options through", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/tenant/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          limitPerSection: 25,
          includeObjectPayloads: true,
          objectPayloadMaxBytes: 4096
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.exportTenantDataBundle).toHaveBeenCalledWith(
      {
        tenantKey: "tenant-a",
        workspaceKey: "workspace-a"
      },
      {
        limitPerSection: 25,
        includeObjectPayloads: true,
        objectPayloadMaxBytes: 4096
      }
    );
  });
});
