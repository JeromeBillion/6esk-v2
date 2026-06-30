import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("auth MFA service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = "session-secret-long-enough";
    process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY = "mfa-secret-long-enough";
    mocks.dbConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease
    });
  });

  it("binds encrypted MFA secrets to tenant and user scope", async () => {
    const { decryptMfaSecret, encryptMfaSecret } = await import("@/server/auth/mfa");
    const scope = { tenantId: TENANT_ID, workspaceKey: "primary", userId: USER_ID };
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP", scope);

    expect(decryptMfaSecret(encrypted, scope)).toBe("JBSWY3DPEHPK3PXP");
    expect(() =>
      decryptMfaSecret(encrypted, {
        ...scope,
        tenantId: "cccccccc-cccc-cccc-cccc-cccccccccccc"
      })
    ).toThrow();
  });

  it("verifies TOTP challenges and marks factor and challenge usage", async () => {
    const { encryptMfaSecret, generateTotpCode, verifyMfaChallenge } = await import("@/server/auth/mfa");
    const scope = { tenantId: TENANT_ID, workspaceKey: "primary", userId: USER_ID };
    const secret = "JBSWY3DPEHPK3PXP";
    const code = generateTotpCode(secret);
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-1",
            tenant_id: TENANT_ID,
            workspace_key: "primary",
            user_id: USER_ID,
            auth_provider: "google_oauth_mfa",
            attempt_count: 0,
            expired: false
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "factor-1",
            secret_encrypted: encryptMfaSecret(secret, scope)
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await verifyMfaChallenge({ challengeToken: "mfa_token", code });

    expect(result).toMatchObject({
      ok: true,
      tenantId: TENANT_ID,
      userId: USER_ID,
      factorId: "factor-1",
      challengeId: "challenge-1",
      authProvider: "google_oauth_mfa"
    });
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), [
      expect.any(String)
    ]);
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining("used_at = now()"), [
      "challenge-1",
      TENANT_ID,
      "primary"
    ]);
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining("last_used_at"), [
      "factor-1",
      TENANT_ID,
      "primary"
    ]);
    expect(mocks.clientQuery).toHaveBeenCalledWith("COMMIT");
    expect(mocks.clientRelease).toHaveBeenCalled();
  });

  it("increments challenge attempts on invalid codes", async () => {
    const { encryptMfaSecret, verifyMfaChallenge } = await import("@/server/auth/mfa");
    const scope = { tenantId: TENANT_ID, workspaceKey: "primary", userId: USER_ID };
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-1",
            tenant_id: TENANT_ID,
            workspace_key: "primary",
            user_id: USER_ID,
            auth_provider: "password_mfa",
            attempt_count: 0,
            expired: false
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "factor-1",
            secret_encrypted: encryptMfaSecret("JBSWY3DPEHPK3PXP", scope)
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await verifyMfaChallenge({
      challengeToken: "mfa_token",
      code: "000000"
    });

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_code",
      tenantId: TENANT_ID
    });
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining("attempt_count"), [
      "challenge-1",
      TENANT_ID,
      "primary"
    ]);
    expect(mocks.clientQuery).toHaveBeenCalledWith("COMMIT");
  });

  it("rejects a valid MFA code if the challenge was already consumed by a concurrent request", async () => {
    const { encryptMfaSecret, generateTotpCode, verifyMfaChallenge } = await import("@/server/auth/mfa");
    const scope = { tenantId: TENANT_ID, workspaceKey: "primary", userId: USER_ID };
    const secret = "JBSWY3DPEHPK3PXP";
    const code = generateTotpCode(secret);
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-1",
            tenant_id: TENANT_ID,
            workspace_key: "primary",
            user_id: USER_ID,
            auth_provider: "password_mfa",
            attempt_count: 0,
            expired: false
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "factor-1",
            secret_encrypted: encryptMfaSecret(secret, scope)
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [] });

    const result = await verifyMfaChallenge({ challengeToken: "mfa_token", code });

    expect(result).toMatchObject({
      ok: false,
      code: "invalid_challenge",
      tenantId: TENANT_ID
    });
    expect(mocks.clientQuery).toHaveBeenCalledWith(expect.stringContaining("used_at = now()"), [
      "challenge-1",
      TENANT_ID,
      "primary"
    ]);
    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.clientQuery).not.toHaveBeenCalledWith(expect.stringContaining("last_used_at"), expect.any(Array));
  });

  it("stores the intended final session provider on MFA challenges", async () => {
    const { createMfaChallenge } = await import("@/server/auth/mfa");
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    await createMfaChallenge(
      { id: USER_ID, tenant_id: TENANT_ID },
      { authProvider: "microsoft_oauth_mfa" }
    );

    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("auth_provider"),
      expect.arrayContaining(["microsoft_oauth_mfa"])
    );
  });
});
