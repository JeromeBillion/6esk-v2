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
  upsertTenantSecurityPolicy
} from "@/server/auth/tenant-security-policy";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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
          tenant_id: TENANT_ID,
          workspace_key: "primary",
          allowed_login_domains: ["example.com"],
          enforce_sso: true,
          require_mfa_for_admins: true,
          session_ttl_days: 14,
          auth_provider: "oauth",
          oidc_issuer: null
        }
      ]
    });

    const policy = await getTenantSecurityPolicy({
      tenantId: TENANT_ID,
      workspaceKey: "primary"
    });

    expect(policy).toMatchObject({
      tenant_id: TENANT_ID,
      workspace_key: "primary",
      auth_provider: "oauth"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE tenant_id = $1"),
      [TENANT_ID, "primary"]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND workspace_key = $2"),
      [TENANT_ID, "primary"]
    );
  });

  it("upserts tenant security policy inside the requested workspace", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_id: TENANT_ID,
          workspace_key: "primary",
          allowed_login_domains: ["example.com"],
          enforce_sso: true,
          require_mfa_for_admins: true,
          session_ttl_days: 7,
          auth_provider: "oauth",
          oidc_issuer: null
        }
      ]
    });

    const policy = await upsertTenantSecurityPolicy(
      { tenantId: TENANT_ID, workspaceKey: "primary" },
      {
        allowedLoginDomains: ["@Example.com", "example.com"],
        enforceSso: true,
        requireMfaForAdmins: true,
        sessionTtlDays: 7,
        authProvider: "oauth",
        oidcIssuer: null
      }
    );

    expect(policy).toMatchObject({
      tenant_id: TENANT_ID,
      workspace_key: "primary",
      allowed_login_domains: ["example.com"],
      enforce_sso: true
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (tenant_id, workspace_key)"),
      [
        TENANT_ID,
        "primary",
        ["example.com"],
        true,
        true,
        7,
        "oauth",
        null
      ]
    );
  });

  it("rejects inconsistent SSO and OIDC policy combinations", async () => {
    await expect(
      upsertTenantSecurityPolicy(
        { tenantId: TENANT_ID, workspaceKey: "primary" },
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
        { tenantId: TENANT_ID, workspaceKey: "primary" },
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
