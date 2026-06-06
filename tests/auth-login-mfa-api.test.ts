import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  verifyPassword: vi.fn(),
  createSession: vi.fn(),
  isMfaRequiredForLogin: vi.fn(),
  hasActiveMfaFactor: vi.fn(),
  createMfaChallenge: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/auth/password", () => ({
  verifyPassword: mocks.verifyPassword
}));

vi.mock("@/server/auth/session", () => ({
  createSession: mocks.createSession
}));

vi.mock("@/server/auth/mfa", () => ({
  isMfaRequiredForLogin: mocks.isMfaRequiredForLogin,
  hasActiveMfaFactor: mocks.hasActiveMfaFactor,
  createMfaChallenge: mocks.createMfaChallenge
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST } from "@/app/api/auth/login/route";

const adminUser = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  email: "admin@example.test",
  password_hash: "hash",
  is_active: true,
  tenant_key: "tenant-login",
  workspace_key: "workspace-login",
  role_name: "lead_admin"
};

function loginRequest() {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "user-agent": "Vitest" },
    body: JSON.stringify({
      tenantKey: "tenant-login",
      email: "admin@example.test",
      password: "correct-password"
    })
  });
}

describe("password login MFA boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.createSession.mockResolvedValue(undefined);
    mocks.verifyPassword.mockReturnValue(true);
    mocks.dbQuery.mockResolvedValue({ rows: [adminUser] });
  });

  it("returns an MFA challenge instead of minting a session when a factor exists", async () => {
    mocks.isMfaRequiredForLogin.mockResolvedValue(true);
    mocks.hasActiveMfaFactor.mockResolvedValue(true);
    mocks.createMfaChallenge.mockResolvedValue({
      challengeToken: "mfa_token",
      expiresAt: new Date("2026-06-02T10:10:00.000Z")
    });

    const response = await POST(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "mfa_required",
      challengeToken: "mfa_token"
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("allows rollout enrollment when MFA is required but no factor exists", async () => {
    mocks.isMfaRequiredForLogin.mockResolvedValue(true);
    mocks.hasActiveMfaFactor.mockResolvedValue(false);

    const response = await POST(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", mfaEnrollmentRequired: true });
    expect(mocks.createSession).toHaveBeenCalledWith(adminUser.id, {
      authProvider: "password_mfa_enrollment_required",
      requestHeaders: expect.any(Headers)
    });
  });

  it("mints a normal password session when MFA is not required", async () => {
    mocks.isMfaRequiredForLogin.mockResolvedValue(false);

    const response = await POST(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", mfaEnrollmentRequired: false });
    expect(mocks.hasActiveMfaFactor).not.toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledWith(adminUser.id, {
      authProvider: "password",
      requestHeaders: expect.any(Headers)
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-login",
        workspaceKey: "workspace-login",
        actorUserId: adminUser.id,
        action: "auth_login_success",
        entityType: "auth_session",
        data: expect.objectContaining({
          authProvider: "password",
          mfaEnrollmentRequired: false,
          mfaSatisfied: false
        })
      })
    );
  });

  it("records a tenant-scoped audit event for invalid passwords", async () => {
    mocks.verifyPassword.mockReturnValue(false);

    const response = await POST(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Invalid credentials" });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-login",
        workspaceKey: "workspace-login",
        actorUserId: adminUser.id,
        action: "auth_login_failed",
        entityType: "auth_session",
        data: expect.objectContaining({
          authProvider: "password",
          reason: "invalid_password",
          emailDomain: "example.test"
        })
      })
    );
  });

  it("records login failure without raw email for unknown users", async () => {
    mocks.dbQuery.mockResolvedValue({ rows: [] });

    const response = await POST(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Invalid credentials" });
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-login",
        workspaceKey: "primary",
        actorUserId: null,
        action: "auth_login_failed",
        data: expect.objectContaining({
          reason: "unknown_user",
          emailDomain: "example.test"
        })
      })
    );
  });
});
