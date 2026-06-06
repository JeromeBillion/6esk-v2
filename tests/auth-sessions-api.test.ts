import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  listUserSessions: vi.fn(),
  revokeSessionForUser: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionContext: mocks.getSessionContext,
  listUserSessions: mocks.listUserSessions,
  revokeSessionForUser: mocks.revokeSessionForUser
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { DELETE, GET } from "@/app/api/auth/sessions/route";

const user = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  email: "admin@example.com",
  display_name: "Admin",
  role_id: null,
  role_name: "lead_admin",
  tenant_key: "tenant-auth",
  workspace_key: "workspace-auth"
};

describe("/api/auth/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists current user's sessions and marks the current session", async () => {
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      user
    });
    mocks.listUserSessions.mockResolvedValue([
      {
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        auth_provider: "password",
        created_at: "2026-06-02T10:00:00.000Z",
        last_seen_at: null,
        expires_at: "2026-06-16T10:00:00.000Z",
        revoked_at: null,
        revoke_reason: null,
        has_device_fingerprint: true
      }
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessions[0]).toMatchObject({
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      current: true
    });
  });

  it("revokes only a session owned by the current user scope", async () => {
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      user
    });
    mocks.revokeSessionForUser.mockResolvedValue(true);

    const response = await DELETE(
      new Request("http://localhost/api/auth/sessions", {
        method: "DELETE",
        body: JSON.stringify({ sessionId: "cccccccc-cccc-cccc-cccc-cccccccccccc" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", current: false });
    expect(mocks.revokeSessionForUser).toHaveBeenCalledWith({
      sessionId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      user,
      reason: "user_revoked"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-auth",
        workspaceKey: "workspace-auth",
        action: "auth_session_revoked"
      })
    );
  });
});
