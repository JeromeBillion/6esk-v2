import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  dbQuery: vi.fn(),
  parseAuthOAuthState: vi.fn(),
  exchangeAuthOAuthCode: vi.fn(),
  fetchAuthOAuthProfile: vi.fn(),
  createSession: vi.fn(),
  getTenantSecurityPolicy: vi.fn(),
  isEmailAllowedByPolicy: vi.fn(),
  isMfaRequiredForLogin: vi.fn(),
  hasActiveMfaFactor: vi.fn(),
  createMfaChallenge: vi.fn(),
  recordAuditLog: vi.fn(),
  recordPlatformAuditLog: vi.fn()
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: mocks.cookieGet,
    set: mocks.cookieSet
  }))
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/auth/oauth-login", () => ({
  exchangeAuthOAuthCode: mocks.exchangeAuthOAuthCode,
  fetchAuthOAuthProfile: mocks.fetchAuthOAuthProfile,
  parseAuthOAuthState: mocks.parseAuthOAuthState,
  sanitizeAuthReturnTo: (value: string | null | undefined) =>
    value?.startsWith("/") && !value.startsWith("//") ? value : "/tickets"
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

import { GET } from "@/app/api/auth/oauth/callback/route";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const state = {
  provider: "google",
  nonce: "nonce-value",
  returnTo: "/tickets",
  issuedAt: Date.now()
};
const activeUser = {
  id: USER_ID,
  email: "admin@example.test",
  is_active: true,
  tenant_id: TENANT_ID,
  role_name: "tenant_admin"
};

function callbackRequest() {
  return new Request("http://localhost/api/auth/oauth/callback?code=provider-code&state=encoded-state");
}

function redirectedPath(response: Response) {
  const location = response.headers.get("location");
  if (!location) return null;
  const parsed = new URL(location);
  return `${parsed.pathname}${parsed.search}`;
}

describe("/api/auth/oauth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue({ value: "nonce-value" });
    mocks.parseAuthOAuthState.mockReturnValue(state);
    mocks.exchangeAuthOAuthCode.mockResolvedValue({ accessToken: "access-token", expiresIn: 3600 });
    mocks.fetchAuthOAuthProfile.mockResolvedValue({
      provider: "google",
      providerAccountId: "google-subject",
      email: "admin@example.test",
      emailVerified: true
    });
    mocks.dbQuery.mockResolvedValue({ rows: [activeUser] });
    mocks.getTenantSecurityPolicy.mockResolvedValue(null);
    mocks.isEmailAllowedByPolicy.mockReturnValue(true);
    mocks.isMfaRequiredForLogin.mockResolvedValue(false);
    mocks.createSession.mockResolvedValue(undefined);
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.recordPlatformAuditLog.mockResolvedValue(undefined);
  });

  it("mints a v2 session for a known active user after provider identity proof", async () => {
    const response = await GET(callbackRequest());

    expect(response.status).toBe(302);
    expect(redirectedPath(response)).toBe("/tickets");
    expect(mocks.createSession).toHaveBeenCalledWith(USER_ID, {
      authProvider: "google_oauth",
      requestHeaders: expect.any(Headers)
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "auth_oauth_login_success",
        data: expect.objectContaining({
          provider: "google",
          providerAccountId: "google-subject"
        })
      })
    );
  });

  it("rejects callback replay when the state nonce does not match the http-only cookie", async () => {
    mocks.cookieGet.mockReturnValue({ value: "different-nonce" });

    const response = await GET(callbackRequest());

    expect(response.status).toBe(302);
    expect(redirectedPath(response)).toBe("/login?error=oauth_invalid_state");
    expect(mocks.exchangeAuthOAuthCode).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("applies tenant login-domain policy before creating a session", async () => {
    mocks.getTenantSecurityPolicy.mockResolvedValue({
      allowed_login_domains: ["acme.example"],
      enforce_sso: false,
      auth_provider: "oauth"
    });
    mocks.isEmailAllowedByPolicy.mockReturnValue(false);

    const response = await GET(callbackRequest());

    expect(response.status).toBe(302);
    expect(redirectedPath(response)).toBe("/login?error=oauth_invalid_account");
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        action: "auth_oauth_login_failed",
        data: expect.objectContaining({
          reason: "login_domain_denied",
          emailDomain: "example.test"
        })
      })
    );
  });

  it("creates an MFA challenge instead of a session for enrolled privileged users", async () => {
    mocks.isMfaRequiredForLogin.mockResolvedValue(true);
    mocks.hasActiveMfaFactor.mockResolvedValue(true);
    mocks.createMfaChallenge.mockResolvedValue({
      challengeToken: "mfa-token",
      expiresAt: new Date("2026-06-06T10:10:00.000Z")
    });

    const response = await GET(callbackRequest());

    expect(response.status).toBe(302);
    expect(redirectedPath(response)).toBe("/login?mfa=required&returnTo=%2Ftickets");
    expect(response.headers.get("location")).not.toContain("challengeToken");
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "sixesk_auth_oauth_mfa_challenge",
      "mfa-token",
      expect.objectContaining({
        httpOnly: true,
        path: "/api/auth/mfa",
        maxAge: 600
      })
    );
    expect(mocks.createMfaChallenge).toHaveBeenCalledWith(activeUser, {
      authProvider: "google_oauth_mfa"
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
