import { Secret, TOTP } from "otpauth";
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
  createMfaChallenge,
  decryptMfaSecret,
  encryptMfaSecret,
  isMfaRequiredForLogin,
  startTotpEnrollment,
  verifyMfaChallenge,
  verifyTotpEnrollment
} from "@/server/auth/mfa";

const scope = {
  tenantKey: "tenant-mfa",
  workspaceKey: "workspace-mfa",
  userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
};

function currentTotpCode(secretBase32: string) {
  return new TOTP({
    issuer: "6esk",
    label: "admin@example.test",
    secret: Secret.fromBase32(secretBase32),
    algorithm: "SHA1",
    digits: 6,
    period: 30
  }).generate();
}

function invalidCodeFrom(validCode: string) {
  const last = Number(validCode.at(-1) ?? "0");
  return `${validCode.slice(0, -1)}${(last + 1) % 10}`;
}

describe("auth MFA service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "session-secret-with-enough-length";
    process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY = "mfa-secret-encryption-key-32-bytes";
    process.env.AUTH_REQUIRE_MFA_ADMIN = "true";
  });

  it("encrypts TOTP seeds with tenant and user authenticated data", () => {
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP", scope);

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(decryptMfaSecret(encrypted, scope)).toBe("JBSWY3DPEHPK3PXP");
    expect(() =>
      decryptMfaSecret(encrypted, {
        ...scope,
        workspaceKey: "other-workspace"
      })
    ).toThrow();
  });

  it("resolves privileged MFA requirement from tenant policy", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_key: "tenant-mfa",
          workspace_key: "workspace-mfa",
          allowed_login_domains: ["example.test"],
          enforce_sso: false,
          require_mfa_for_admins: true,
          session_ttl_days: 14,
          auth_provider: "password",
          oidc_issuer: null
        }
      ]
    });

    await expect(
      isMfaRequiredForLogin({
        tenant_key: "tenant-mfa",
        workspace_key: "workspace-mfa",
        role_name: "lead_admin"
      })
    ).resolves.toBe(true);
  });

  it("creates tenant-scoped challenge tokens without storing the raw token", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });

    const challenge = await createMfaChallenge({
      id: scope.userId,
      tenant_key: scope.tenantKey,
      workspace_key: scope.workspaceKey
    });

    expect(challenge.challengeToken).toMatch(/^mfa_/);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO auth_mfa_challenges"),
      [
        scope.tenantKey,
        scope.workspaceKey,
        scope.userId,
        expect.not.stringContaining(challenge.challengeToken),
        expect.any(Date)
      ]
    );
  });

  it("starts and verifies a TOTP enrollment", async () => {
    mocks.dbQuery.mockResolvedValueOnce({ rows: [] });
    const enrollment = await startTotpEnrollment({
      user: {
        id: scope.userId,
        email: "admin@example.test",
        tenant_key: scope.tenantKey,
        workspace_key: scope.workspaceKey
      }
    });
    const encryptedSeed = mocks.dbQuery.mock.calls[0][1][4] as string;
    const code = currentTotpCode(enrollment.secretBase32);

    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "enrollment-1",
            secret_encrypted: encryptedSeed,
            label: "admin@example.test"
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ id: "factor-1" }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      verifyTotpEnrollment({
        user: {
          id: scope.userId,
          tenant_key: scope.tenantKey,
          workspace_key: scope.workspaceKey
        },
        enrollmentToken: enrollment.enrollmentToken,
        code
      })
    ).resolves.toMatchObject({ ok: true, factorId: "factor-1" });
  });

  it("verifies a challenge and marks the factor and challenge used", async () => {
    const secretBase32 = new Secret({ size: 20 }).base32;
    const code = currentTotpCode(secretBase32);
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-1",
            tenant_key: scope.tenantKey,
            workspace_key: scope.workspaceKey,
            user_id: scope.userId,
            attempt_count: 0,
            expired: false
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "factor-1",
            secret_encrypted: encryptMfaSecret(secretBase32, scope)
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(verifyMfaChallenge({ challengeToken: "mfa_token", code })).resolves.toMatchObject({
      ok: true,
      userId: scope.userId,
      factorId: "factor-1",
      challengeId: "challenge-1"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET last_used_at = now()"),
      ["factor-1", scope.tenantKey, scope.workspaceKey]
    );
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET used_at = now()"),
      ["challenge-1", scope.tenantKey, scope.workspaceKey]
    );
  });

  it("increments challenge attempts when the TOTP code is invalid", async () => {
    const secretBase32 = new Secret({ size: 20 }).base32;
    const invalidCode = invalidCodeFrom(currentTotpCode(secretBase32));
    mocks.dbQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: "challenge-1",
            tenant_key: scope.tenantKey,
            workspace_key: scope.workspaceKey,
            user_id: scope.userId,
            attempt_count: 0,
            expired: false
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "factor-1",
            secret_encrypted: encryptMfaSecret(secretBase32, scope)
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(verifyMfaChallenge({ challengeToken: "mfa_token", code: invalidCode })).resolves.toMatchObject({
      ok: false,
      code: "invalid_code"
    });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("SET attempt_count = attempt_count + 1"),
      ["challenge-1", scope.tenantKey, scope.workspaceKey]
    );
  });
});
