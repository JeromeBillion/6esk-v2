import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getTenantSecurityPolicyOrDefault: vi.fn(),
  upsertTenantSecurityPolicy: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/tenant-security-policy", () => ({
  getTenantSecurityPolicyOrDefault: mocks.getTenantSecurityPolicyOrDefault,
  upsertTenantSecurityPolicy: mocks.upsertTenantSecurityPolicy
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { GET, PUT } from "@/app/api/admin/tenant/security-policy/route";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const POLICY = {
  tenant_id: TENANT_ID,
  workspace_key: "primary",
  allowed_login_domains: ["example.test"],
  enforce_sso: false,
  require_mfa_for_admins: true,
  session_ttl_days: 14,
  auth_provider: "password",
  oidc_issuer: null
};

function buildUser(roleName: "tenant_admin" | "agent") {
  return {
    id: USER_ID,
    email: `${roleName}@example.test`,
    display_name: roleName,
    role_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    role_name: roleName,
    tenant_id: TENANT_ID,
    tenant_slug: "acme",
    real_tenant_id: TENANT_ID,
    is_impersonating: false
  };
}

describe("/api/admin/tenant/security-policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("agent"));

    const response = await GET();

    expect(response.status).toBe(403);
    expect(mocks.getTenantSecurityPolicyOrDefault).not.toHaveBeenCalled();
  });

  it("returns the tenant security policy in client-safe shape", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("tenant_admin"));
    mocks.getTenantSecurityPolicyOrDefault.mockResolvedValue(POLICY);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.policy).toEqual({
      tenantId: TENANT_ID,
      workspaceKey: "primary",
      allowedLoginDomains: ["example.test"],
      enforceSso: false,
      requireMfaForAdmins: true,
      sessionTtlDays: 14,
      authProvider: "password",
      oidcIssuer: null
    });
  });

  it("updates tenant policy inside the session tenant and audits it", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("tenant_admin"));
    mocks.upsertTenantSecurityPolicy.mockResolvedValue({
      ...POLICY,
      allowed_login_domains: ["acme.example"],
      session_ttl_days: 7
    });

    const response = await PUT(
      new Request("http://localhost/api/admin/tenant/security-policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allowedLoginDomains: ["acme.example"],
          enforceSso: false,
          requireMfaForAdmins: true,
          sessionTtlDays: 7,
          authProvider: "password"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.policy).toMatchObject({
      tenantId: TENANT_ID,
      allowedLoginDomains: ["acme.example"],
      sessionTtlDays: 7
    });
    expect(mocks.upsertTenantSecurityPolicy).toHaveBeenCalledWith(
      { tenantId: TENANT_ID, workspaceKey: "primary" },
      expect.objectContaining({
        allowedLoginDomains: ["acme.example"],
        sessionTtlDays: 7
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "tenant_security_policy_updated"
      })
    );
  });

  it("accepts managed OAuth as the tenant SSO provider mode", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser("tenant_admin"));
    mocks.upsertTenantSecurityPolicy.mockResolvedValue({
      ...POLICY,
      allowed_login_domains: ["acme.example"],
      enforce_sso: true,
      auth_provider: "oauth"
    });

    const response = await PUT(
      new Request("http://localhost/api/admin/tenant/security-policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allowedLoginDomains: ["acme.example"],
          enforceSso: true,
          requireMfaForAdmins: true,
          sessionTtlDays: 14,
          authProvider: "oauth"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.policy).toMatchObject({
      enforceSso: true,
      authProvider: "oauth"
    });
    expect(mocks.upsertTenantSecurityPolicy).toHaveBeenCalledWith(
      { tenantId: TENANT_ID, workspaceKey: "primary" },
      expect.objectContaining({
        enforceSso: true,
        authProvider: "oauth"
      })
    );
  });
});
