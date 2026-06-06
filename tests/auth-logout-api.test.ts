import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearSession: vi.fn(),
  getSessionContext: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  clearSession: mocks.clearSession,
  getSessionContext: mocks.getSessionContext
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/auth/logout/route";

const user = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  email: "admin@example.test",
  display_name: "Admin",
  role_id: "role-admin",
  role_name: "lead_admin",
  tenant_key: "tenant-auth",
  workspace_key: "workspace-auth"
};

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearSession.mockResolvedValue(undefined);
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("clears the session and records a tenant-scoped logout audit event", async () => {
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      user
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
    expect(mocks.clearSession).toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith({
      tenantKey: "tenant-auth",
      workspaceKey: "workspace-auth",
      actorUserId: user.id,
      action: "auth_logout",
      entityType: "auth_session",
      entityId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      data: {
        reason: "user_logout"
      }
    });
  });

  it("still clears stale or anonymous sessions without writing an audit event", async () => {
    mocks.getSessionContext.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.clearSession).toHaveBeenCalled();
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
  });
});
