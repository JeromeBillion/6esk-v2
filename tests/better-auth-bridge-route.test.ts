import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  getBetterSession: vi.fn(),
  createSession: vi.fn(),
  isMfaRequiredForLogin: vi.fn(),
  hasActiveMfaFactor: vi.fn(),
  createMfaChallenge: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/better-auth", () => ({
  sixeskBetterAuth: {
    api: {
      getSession: mocks.getBetterSession
    }
  }
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

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { GET } from "@/app/api/auth/better/bridge/route";

function configureReadyEnv() {
  process.env.NODE_ENV = "development";
  process.env.AUTH_PROVIDER = "better_auth";
  process.env.AUTH_OAUTH_ENABLED = "true";
  process.env.AUTH_REQUIRE_MFA_ADMIN = "true";
  process.env.AUTH_SESSION_DEVICE_TRACKING = "true";
  process.env.AUTH_BETTER_AUTH_ROUTE_ENABLED = "true";
  process.env.AUTH_BETTER_AUTH_DB_BRIDGE_READY = "true";
  process.env.BETTER_AUTH_SECRET = "better-auth-secret-with-enough-length";
  process.env.AUTH_GOOGLE_CLIENT_ID = "google-client";
  process.env.AUTH_GOOGLE_CLIENT_SECRET = "google-secret";
  process.env.AUTH_CACHE_PROVIDER = "none";
}

describe("GET /api/auth/better/bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureReadyEnv();
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.createSession.mockResolvedValue(undefined);
    mocks.isMfaRequiredForLogin.mockResolvedValue(false);
    mocks.hasActiveMfaFactor.mockResolvedValue(false);
    mocks.createMfaChallenge.mockResolvedValue({
      challengeToken: "mfa_token",
      expiresAt: new Date("2026-06-02T10:10:00.000Z")
    });
  });

  it("mints a tenant-scoped 6esk session for an authorized federated user", async () => {
    mocks.getBetterSession.mockResolvedValue({
      user: { id: "better-user-1", email: "Agent@Example.com" },
      session: { id: "better-session-1" }
    });
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
      })
      .mockResolvedValueOnce({
        rows: [{ provider_id: "google", account_id: "google-sub", scope: "openid email" }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await GET(
      new Request("http://localhost/api/auth/better/bridge?next=/admin", {
        headers: {
          accept: "application/json",
          "user-agent": "Vitest",
          "x-forwarded-for": "203.0.113.10"
        }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      next: "/admin",
      provider: "google",
      mfaEnrollmentRequired: false
    });
    expect(mocks.createSession).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        authProvider: "better_auth",
        requestHeaders: expect.any(Headers)
      })
    );
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-auth",
        workspaceKey: "workspace-auth",
        actorUserId: "user-1",
        action: "better_auth_bridge_session_created"
      })
    );
  });

  it("denies bridge minting when no tenant policy matches the email", async () => {
    mocks.getBetterSession.mockResolvedValue({
      user: { id: "better-user-1", email: "agent@unknown.test" },
      session: { id: "better-session-1" }
    });
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const response = await GET(
      new Request("http://localhost/api/auth/better/bridge", {
        headers: { accept: "application/json" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ code: "tenant_policy_not_found" });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("returns an MFA challenge for a privileged federated user with an active factor", async () => {
    mocks.isMfaRequiredForLogin.mockResolvedValue(true);
    mocks.hasActiveMfaFactor.mockResolvedValue(true);
    mocks.getBetterSession.mockResolvedValue({
      user: { id: "better-user-1", email: "Admin@Example.com" },
      session: { id: "better-session-1" }
    });
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
            id: "user-admin",
            email: "admin@example.com",
            is_active: true,
            tenant_key: "tenant-auth",
            workspace_key: "workspace-auth",
            role_name: "lead_admin"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ provider_id: "google", account_id: "google-sub", scope: "openid email" }]
      })
      .mockResolvedValueOnce({ rows: [] });

    const response = await GET(
      new Request("http://localhost/api/auth/better/bridge?next=/admin", {
        headers: { accept: "application/json" }
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "mfa_required",
      challengeToken: "mfa_token",
      next: "/admin",
      provider: "google"
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
