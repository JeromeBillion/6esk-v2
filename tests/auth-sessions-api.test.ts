import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  listUserSessions: vi.fn(),
  revokeSessionForUser: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser,
  listUserSessions: mocks.listUserSessions,
  revokeSessionForUser: mocks.revokeSessionForUser
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { DELETE, GET } from "@/app/api/auth/sessions/route";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SESSION_ID = "11111111-1111-1111-1111-111111111111";

const USER = {
  id: USER_ID,
  email: "admin@example.test",
  display_name: "Admin",
  role_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  role_name: "tenant_admin",
  tenant_id: TENANT_ID,
  tenant_slug: "acme",
  real_tenant_id: TENANT_ID,
  is_impersonating: false
};

describe("/api/auth/sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("requires an authenticated session", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.listUserSessions).not.toHaveBeenCalled();
  });

  it("lists the current user's sessions inside their tenant", async () => {
    const sessions = [
      {
        id: SESSION_ID,
        auth_provider: "password_mfa",
        created_at: "2026-06-06T10:00:00.000Z",
        last_seen_at: null,
        expires_at: "2026-06-20T10:00:00.000Z",
        revoked_at: null,
        revoke_reason: null,
        has_device_fingerprint: true
      }
    ];
    mocks.getSessionUser.mockResolvedValue(USER);
    mocks.listUserSessions.mockResolvedValue(sessions);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessions).toEqual(sessions);
    expect(mocks.listUserSessions).toHaveBeenCalledWith(USER);
  });

  it("revokes one of the current user's sessions and records an audit event", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    mocks.revokeSessionForUser.mockResolvedValue(true);

    const response = await DELETE(
      new Request("http://localhost/api/auth/sessions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: SESSION_ID,
          reason: "device_lost"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "revoked" });
    expect(mocks.revokeSessionForUser).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      user: USER,
      reason: "device_lost"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "auth_session_revoked",
        entityId: SESSION_ID
      })
    );
  });

  it("does not audit when the session is outside the user's scope", async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    mocks.revokeSessionForUser.mockResolvedValue(false);

    const response = await DELETE(
      new Request("http://localhost/api/auth/sessions", {
        method: "DELETE",
        body: JSON.stringify({ sessionId: SESSION_ID })
      })
    );

    expect(response.status).toBe(404);
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
  });
});
