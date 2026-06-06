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
  lookupBetterAuthProviderAccount,
  resolveBetterAuthBridgeUser,
  sanitizeBetterAuthNextPath,
  upsertAuthIdentityAccount
} from "@/server/auth/better-auth-bridge";

describe("Better Auth tenant bridge helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sanitizes post-login redirect paths to same-origin relative paths", () => {
    expect(sanitizeBetterAuthNextPath("/tickets?view=open")).toBe("/tickets?view=open");
    expect(sanitizeBetterAuthNextPath("https://evil.example")).toBe("/tickets");
    expect(sanitizeBetterAuthNextPath("//evil.example/path")).toBe("/tickets");
    expect(sanitizeBetterAuthNextPath(null)).toBe("/tickets");
  });

  it("requires an unambiguous tenant policy and active app user", async () => {
    mocks.dbQuery
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "user-1",
            email: "agent@example.com",
            is_active: true,
            tenant_key: "tenant-auth",
            workspace_key: "workspace-auth",
            role_name: "agent"
          }
        ]
      });

    const resolution = await resolveBetterAuthBridgeUser("Agent@Example.com");

    expect(resolution).toMatchObject({
      ok: true,
      user: {
        id: "user-1",
        tenant_key: "tenant-auth",
        workspace_key: "workspace-auth"
      }
    });
    expect(mocks.dbQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("AND u.workspace_key = $2"),
      ["tenant-auth", "workspace-auth", "agent@example.com"]
    );
  });

  it("denies login when no tenant policy matches the email domain", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    await expect(resolveBetterAuthBridgeUser("agent@unknown.test")).resolves.toMatchObject({
      ok: false,
      code: "tenant_policy_not_found"
    });
  });

  it("reads the latest Better Auth provider account and scopes", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          provider_id: "google",
          account_id: "google-sub",
          scope: "openid email profile"
        }
      ]
    });

    await expect(lookupBetterAuthProviderAccount("better-user-1")).resolves.toEqual({
      providerId: "google",
      accountId: "google-sub",
      scopes: ["openid", "email", "profile"]
    });
  });

  it("upserts the app identity account with tenant scope", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    await upsertAuthIdentityAccount({
      user: {
        id: "user-1",
        email: "agent@example.com",
        is_active: true,
        tenant_key: "tenant-auth",
        workspace_key: "workspace-auth",
        role_name: "agent"
      },
      provider: {
        providerId: "microsoft",
        accountId: "entra-oid",
        scopes: ["openid", "email"]
      },
      betterAuthUserId: "better-user-1",
      betterAuthSessionId: "better-session-1",
      email: "Agent@Example.com"
    });

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (tenant_key, provider, provider_account_id)"),
      expect.arrayContaining([
        "tenant-auth",
        "workspace-auth",
        "user-1",
        "microsoft",
        "entra-oid",
        "agent@example.com",
        ["openid", "email"]
      ])
    );
  });
});
