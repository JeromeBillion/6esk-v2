import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import {
  domainFromEmail,
  getTenantSecurityPolicy,
  isEmailAllowedByPolicy,
  normalizeLoginDomains,
  resolveTenantSecurityPolicyByEmail,
  upsertTenantSecurityPolicy
} from "@/server/auth/tenant-security-policy";

describe("tenant security policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes domains from email addresses", () => {
    expect(domainFromEmail("Admin@Example.COM")).toBe("example.com");
    expect(domainFromEmail("missing-domain@")).toBeNull();
    expect(domainFromEmail("not-an-email")).toBeNull();
  });

  it("checks email domains against tenant policy allowlists", () => {
    expect(
      isEmailAllowedByPolicy("admin@example.com", {
        allowed_login_domains: ["@Example.com", "acme.test"]
      })
    ).toBe(true);
    expect(
      isEmailAllowedByPolicy("admin@other.test", {
        allowed_login_domains: ["example.com"]
      })
    ).toBe(false);
  });

  it("normalizes and validates login domain allowlists", () => {
    expect(normalizeLoginDomains(["@Example.com", "example.com", "acme.test"])).toEqual([
      "example.com",
      "acme.test"
    ]);
    expect(() => normalizeLoginDomains(["not a domain"])).toThrow("Invalid login domain");
  });

  it("reads tenant security policy inside the requested workspace", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_key: "tenant-auth",
          workspace_key: "workspace-auth",
          allowed_login_domains: ["example.com"],
          enforce_sso: true,
          require_mfa_for_admins: true,
          session_ttl_days: 14,
          auth_provider: "better_auth",
          oidc_issuer: null
        }
      ]
    });

    const policy = await getTenantSecurityPolicy({
      tenantKey: "tenant-auth",
      workspaceKey: "workspace-auth"
    });

    expect(policy).toMatchObject({
      tenant_key: "tenant-auth",
      workspace_key: "workspace-auth",
      auth_provider: "better_auth"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE tenant_key = $1"),
      ["tenant-auth", "workspace-auth"]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND workspace_key = $2"),
      ["tenant-auth", "workspace-auth"]
    );
  });

  it("returns null for ambiguous login domains", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        { tenant_key: "tenant-a", workspace_key: "workspace-a" },
        { tenant_key: "tenant-b", workspace_key: "workspace-b" }
      ]
    });

    await expect(resolveTenantSecurityPolicyByEmail("admin@example.com")).resolves.toBeNull();
    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("LIMIT 2"), ["example.com"]);
  });

  it("upserts tenant security policy inside the requested workspace", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_key: "tenant-auth",
          workspace_key: "workspace-auth",
          allowed_login_domains: ["example.com"],
          enforce_sso: true,
          require_mfa_for_admins: true,
          session_ttl_days: 7,
          auth_provider: "better_auth",
          oidc_issuer: null
        }
      ]
    });

    const policy = await upsertTenantSecurityPolicy(
      { tenantKey: "tenant-auth", workspaceKey: "workspace-auth" },
      {
        allowedLoginDomains: ["@Example.com", "example.com"],
        enforceSso: true,
        requireMfaForAdmins: true,
        sessionTtlDays: 7,
        authProvider: "better_auth",
        oidcIssuer: null
      }
    );

    expect(policy).toMatchObject({
      tenant_key: "tenant-auth",
      workspace_key: "workspace-auth",
      allowed_login_domains: ["example.com"],
      enforce_sso: true
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (tenant_key, workspace_key)"),
      [
        "tenant-auth",
        "workspace-auth",
        ["example.com"],
        true,
        true,
        7,
        "better_auth",
        null
      ]
    );
  });

  it("rejects inconsistent SSO and OIDC policy combinations", async () => {
    await expect(
      upsertTenantSecurityPolicy(
        { tenantKey: "tenant-auth", workspaceKey: "workspace-auth" },
        {
          allowedLoginDomains: ["example.com"],
          enforceSso: true,
          requireMfaForAdmins: true,
          sessionTtlDays: 14,
          authProvider: "password",
          oidcIssuer: null
        }
      )
    ).rejects.toThrow("SSO enforcement requires");

    await expect(
      upsertTenantSecurityPolicy(
        { tenantKey: "tenant-auth", workspaceKey: "workspace-auth" },
        {
          allowedLoginDomains: ["example.com"],
          enforceSso: true,
          requireMfaForAdmins: true,
          sessionTtlDays: 14,
          authProvider: "oidc_broker",
          oidcIssuer: null
        }
      )
    ).rejects.toThrow("OIDC broker mode requires");
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });
});
