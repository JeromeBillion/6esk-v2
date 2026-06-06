import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActivePrivilegedAccessGrantForSubject: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/privileged-access", () => ({
  getActivePrivilegedAccessGrantForSubject: mocks.getActivePrivilegedAccessGrantForSubject
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import {
  PRIVILEGED_ACCESS_GRANT_HEADER,
  PrivilegedAccessAuthorizationError,
  resolveTenantDataAccess
} from "@/server/auth/privileged-access-authorization";

function user(roleName: string) {
  return {
    id: "user-1",
    email: `${roleName}@example.test`,
    display_name: roleName,
    role_id: null,
    role_name: roleName,
    tenant_key: "tenant-user",
    workspace_key: "workspace-user"
  };
}

describe("privileged access authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("lets tenant lead admins use their own tenant scope without a grant", async () => {
    await expect(
      resolveTenantDataAccess(new Request("http://localhost/api/admin/audit-logs"), user("lead_admin"), {
        operation: "tenant_audit_log_read"
      })
    ).resolves.toMatchObject({
      mode: "tenant_admin",
      actorUserId: "user-1",
      scope: {
        tenantKey: "tenant-user",
        workspaceKey: "workspace-user"
      }
    });
    expect(mocks.getActivePrivilegedAccessGrantForSubject).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
  });

  it("rejects ordinary users without privileged support role", async () => {
    await expect(
      resolveTenantDataAccess(new Request("http://localhost/api/admin/audit-logs"), user("agent"), {
        operation: "tenant_audit_log_read"
      })
    ).rejects.toBeInstanceOf(PrivilegedAccessAuthorizationError);
    expect(mocks.getActivePrivilegedAccessGrantForSubject).not.toHaveBeenCalled();
  });

  it("requires an active grant for internal support and returns the grant tenant scope", async () => {
    mocks.getActivePrivilegedAccessGrantForSubject.mockResolvedValue({
      id: "grant-1",
      tenant_key: "tenant-grant",
      workspace_key: "workspace-grant",
      access_type: "support",
      subject_email: "internal_support@example.test",
      reference: "INC-1",
      expires_at: "2026-06-04T01:00:00.000Z"
    });

    const request = new Request("http://localhost/api/admin/audit-logs", {
      headers: { [PRIVILEGED_ACCESS_GRANT_HEADER]: "grant-1" }
    });

    await expect(
      resolveTenantDataAccess(request, user("internal_support"), {
        operation: "tenant_audit_log_read",
        accessTypes: ["support"]
      })
    ).resolves.toMatchObject({
      mode: "privileged_access",
      actorUserId: null,
      scope: {
        tenantKey: "tenant-grant",
        workspaceKey: "workspace-grant"
      }
    });
    expect(mocks.getActivePrivilegedAccessGrantForSubject).toHaveBeenCalledWith({
      grantId: "grant-1",
      subjectEmail: "internal_support@example.test",
      accessTypes: ["support"]
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-grant",
        workspaceKey: "workspace-grant",
        actorUserId: null,
        action: "privileged_access_used"
      })
    );
  });
});
