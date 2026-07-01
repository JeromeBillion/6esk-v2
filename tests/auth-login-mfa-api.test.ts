import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  verifyPassword: vi.fn(),
  createSession: vi.fn(),
  getTenantSecurityPolicy: vi.fn(),
  isEmailAllowedByPolicy: vi.fn(),
  isMfaRequiredForLogin: vi.fn(),
  hasActiveMfaFactor: vi.fn(),
  createMfaChallenge: vi.fn(),
  recordAuditLog: vi.fn(),
  recordPlatformAuditLog: vi.fn()
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

vi.mock("@/server/auth/tenant-security-policy", () => ({
  getTenantSecurityPolicy: mocks.getTenantSecurityPolicy,
  isEmailAllowedByPolicy: mocks.isEmailAllowedByPolicy
}));

vi.mock("@/server/auth/mfa", () => ({
  isMfaRequiredForLogin: mocks.isMfaRequiredForLogin,
  hasActiveMfaFactor: mocks.hasActiveMfaFactor,
  createMfaChallenge: mocks.createMfaChallenge
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog,
  recordPlatformAuditLog: mocks.recordPlatformAuditLog
}));

import { POST } from "@/app/api/auth/login/route";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const adminUser = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  email: "admin@example.test",
  password_hash: "hash",
  is_active: true,
  tenant_id: TENANT_ID,
  role_name: "tenant_admin"
};

function loginRequest() {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "user-agent": "Vitest" },
    body: JSON.stringify({
      email: "admin@example.test",
      password: "correct-password"
    })
  });
}

describe("password login MFA boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.recordPlatformAuditLog.mockResolvedValue(undefined);
    mocks.createSession.mockResolvedValue(undefined);
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.dbQuery.mockResolvedValue({ rows: [adminUser] });
    mocks.getTenantSecurityPolicy.mockResolvedValue(null);
    mocks.isEmailAllowedByPolicy.mockReturnValue(true);
    mocks.isMfaRequiredForLogin.mockResolvedValue(false);
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
    const response = await POST(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", mfaEnrollmentRequired: false });
    expect(mocks.hasActiveMfaFactor).not.toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledWith(adminUser.id, {
      authProvider: "password",
      requestHeaders: expect.any(Headers)
    });
    expect(mocks.dbQuery.mock.calls[0][0]).toContain(
      "LEFT JOIN roles r ON r.id = u.role_id AND r.tenant_id = u.tenant_id"
    );
    expect(mocks.dbQuery.mock.calls[0][0]).toContain("WHERE lower(u.email) = $1");
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
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

  it("rejects password login when the tenant requires SSO", async () => {
    mocks.getTenantSecurityPolicy.mockResolvedValue({
      allowed_login_domains: ["example.test"],
      enforce_sso: true,
      auth_provider: "better_auth"
    });

    const response = await POST(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "SSO is required for this account." });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: adminUser.id,
        action: "auth_login_failed",
        data: expect.objectContaining({
          reason: "sso_required",
          authProvider: "better_auth"
        })
      })
    );
  });

  it("rejects password login when the user email domain is outside tenant policy", async () => {
    mocks.getTenantSecurityPolicy.mockResolvedValue({
      allowed_login_domains: ["acme.example"],
      enforce_sso: false,
      auth_provider: "password"
    });
    mocks.isEmailAllowedByPolicy.mockReturnValue(false);

    const response = await POST(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Invalid credentials" });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: adminUser.id,
        action: "auth_login_failed",
        data: expect.objectContaining({
          reason: "login_domain_denied"
        })
      })
    );
  });

  it("records a tenant-scoped audit event for invalid passwords", async () => {
    mocks.verifyPassword.mockResolvedValue(false);

    const response = await POST(loginRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Invalid credentials" });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: adminUser.id,
        action: "auth_login_failed",
        entityType: "auth_session",
        data: expect.objectContaining({
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
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
    expect(mocks.recordPlatformAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
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
