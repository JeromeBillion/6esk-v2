import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContext: vi.fn(),
  isMfaRequiredForLogin: vi.fn(),
  getTenantSecurityPolicyOrDefault: vi.fn(),
  upsertTenantSecurityPolicy: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionContext: mocks.getSessionContext
}));

vi.mock("@/server/auth/mfa", () => ({
  isMfaRequiredForLogin: mocks.isMfaRequiredForLogin
}));

vi.mock("@/server/auth/tenant-security-policy", () => ({
  getTenantSecurityPolicyOrDefault: mocks.getTenantSecurityPolicyOrDefault,
  upsertTenantSecurityPolicy: mocks.upsertTenantSecurityPolicy
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, POST } from "@/app/api/admin/security/policy/route";

const leadAdmin = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  email: "admin@example.com",
  display_name: "Admin",
  role_id: null,
  role_name: "lead_admin",
  tenant_key: "tenant-sec",
  workspace_key: "workspace-sec"
};

const policy = {
  tenant_key: "tenant-sec",
  workspace_key: "workspace-sec",
  allowed_login_domains: ["example.com"],
  enforce_sso: true,
  require_mfa_for_admins: true,
  session_ttl_days: 7,
  auth_provider: "better_auth",
  oidc_issuer: null
};

describe("/api/admin/security/policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password_mfa",
      user: leadAdmin
    });
    mocks.isMfaRequiredForLogin.mockResolvedValue(true);
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("rejects non-admin policy reads", async () => {
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password",
      user: { ...leadAdmin, role_name: "agent" }
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Forbidden" });
    expect(mocks.getTenantSecurityPolicyOrDefault).not.toHaveBeenCalled();
  });

  it("returns tenant security policy for the admin workspace", async () => {
    mocks.getTenantSecurityPolicyOrDefault.mockResolvedValue(policy);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.policy).toMatchObject({
      tenantKey: "tenant-sec",
      workspaceKey: "workspace-sec",
      allowedLoginDomains: ["example.com"],
      enforceSso: true,
      authProvider: "better_auth"
    });
    expect(mocks.getTenantSecurityPolicyOrDefault).toHaveBeenCalledWith({
      tenantKey: "tenant-sec",
      workspaceKey: "workspace-sec"
    });
  });

  it("updates tenant security policy and records a tenant-scoped audit event", async () => {
    mocks.upsertTenantSecurityPolicy.mockResolvedValue(policy);

    const response = await POST(
      new Request("http://localhost/api/admin/security/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowedLoginDomains: ["example.com"],
          enforceSso: true,
          requireMfaForAdmins: true,
          sessionTtlDays: 7,
          authProvider: "better_auth",
          oidcIssuer: null
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.policy.sessionTtlDays).toBe(7);
    expect(mocks.upsertTenantSecurityPolicy).toHaveBeenCalledWith(
      { tenantKey: "tenant-sec", workspaceKey: "workspace-sec" },
      expect.objectContaining({ authProvider: "better_auth", enforceSso: true })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-sec",
        workspaceKey: "workspace-sec",
        actorUserId: leadAdmin.id,
        action: "tenant_security_policy_updated",
        entityType: "tenant_security_policy",
        entityId: "tenant-sec:workspace-sec",
        data: expect.objectContaining({
          allowedLoginDomains: ["example.com"],
          oidcIssuerConfigured: false
        })
      })
    );
  });

  it("rejects malformed policy payloads", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/security/policy", {
        method: "POST",
        body: JSON.stringify({
          allowedLoginDomains: [],
          enforceSso: true,
          requireMfaForAdmins: true,
          sessionTtlDays: 120,
          authProvider: "password"
        })
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.upsertTenantSecurityPolicy).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).not.toHaveBeenCalled();
  });

  it("requires MFA completion before policy updates", async () => {
    mocks.getSessionContext.mockResolvedValue({
      sessionId: "session-1",
      authProvider: "password_mfa_enrollment_required",
      user: leadAdmin
    });

    const response = await POST(
      new Request("http://localhost/api/admin/security/policy", {
        method: "POST",
        body: JSON.stringify({
          allowedLoginDomains: ["example.com"],
          enforceSso: true,
          requireMfaForAdmins: true,
          sessionTtlDays: 7,
          authProvider: "better_auth"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ code: "mfa_enrollment_required" });
    expect(mocks.upsertTenantSecurityPolicy).not.toHaveBeenCalled();
  });
});
