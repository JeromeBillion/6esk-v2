import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  createSession: vi.fn(),
  getMfaStatusForUser: vi.fn(),
  startTotpEnrollment: vi.fn(),
  verifyTotpEnrollment: vi.fn(),
  verifyMfaChallenge: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser,
  createSession: mocks.createSession
}));

vi.mock("@/server/auth/mfa", () => ({
  getMfaStatusForUser: mocks.getMfaStatusForUser,
  startTotpEnrollment: mocks.startTotpEnrollment,
  verifyTotpEnrollment: mocks.verifyTotpEnrollment,
  verifyMfaChallenge: mocks.verifyMfaChallenge
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST as postChallenge } from "@/app/api/auth/mfa/challenge/route";
import { GET as getEnrollment, POST as postEnrollment } from "@/app/api/auth/mfa/enroll/route";
import { POST as postVerifyEnrollment } from "@/app/api/auth/mfa/enroll/verify/route";

const user = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  email: "admin@example.test",
  display_name: "Admin",
  role_id: "role-admin",
  role_name: "lead_admin",
  tenant_key: "tenant-mfa",
  workspace_key: "workspace-mfa"
};

describe("MFA API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
  });

  it("requires a session before listing enrollment status", async () => {
    mocks.getSessionUser.mockResolvedValue(null);

    const response = await getEnrollment();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("lists current user MFA status", async () => {
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.getMfaStatusForUser.mockResolvedValue({
      required: true,
      factors: [{ id: "factor-1", factor_type: "totp", label: "admin", disabled_at: null }]
    });

    const response = await getEnrollment();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.required).toBe(true);
    expect(mocks.getMfaStatusForUser).toHaveBeenCalledWith(user);
  });

  it("starts a TOTP enrollment for the current user", async () => {
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.startTotpEnrollment.mockResolvedValue({
      enrollmentToken: "mfa_enroll_token",
      otpauthUrl: "otpauth://totp/6esk:admin",
      secretBase32: "JBSWY3DPEHPK3PXP",
      expiresAt: new Date("2026-06-02T10:10:00.000Z")
    });

    const response = await postEnrollment(
      new Request("http://localhost/api/auth/mfa/enroll", {
        method: "POST",
        body: JSON.stringify({ label: "admin phone" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      enrollmentToken: "mfa_enroll_token",
      secretBase32: "JBSWY3DPEHPK3PXP"
    });
    expect(mocks.startTotpEnrollment).toHaveBeenCalledWith({
      user,
      label: "admin phone"
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-mfa",
        workspaceKey: "workspace-mfa",
        action: "auth_mfa_enrollment_started"
      })
    );
  });

  it("verifies a pending TOTP enrollment", async () => {
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.verifyTotpEnrollment.mockResolvedValue({ ok: true, factorId: "factor-1" });

    const response = await postVerifyEnrollment(
      new Request("http://localhost/api/auth/mfa/enroll/verify", {
        method: "POST",
        body: JSON.stringify({ enrollmentToken: "mfa_enroll_token", code: "123456" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", factorId: "factor-1" });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth_mfa_enrollment_verified",
        entityId: "factor-1"
      })
    );
  });

  it("mints an app session only after a valid MFA challenge", async () => {
    mocks.verifyMfaChallenge.mockResolvedValue({
      ok: true,
      userId: user.id,
      tenantKey: user.tenant_key,
      workspaceKey: user.workspace_key,
      factorId: "factor-1",
      challengeId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    });

    const response = await postChallenge(
      new Request("http://localhost/api/auth/mfa/challenge", {
        method: "POST",
        headers: {
          "user-agent": "Vitest"
        },
        body: JSON.stringify({ challengeToken: "mfa_token_with_enough_length", code: "123456" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
    expect(mocks.createSession).toHaveBeenCalledWith(user.id, {
      authProvider: "password_mfa",
      requestHeaders: expect.any(Headers)
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-mfa",
        workspaceKey: "workspace-mfa",
        actorUserId: user.id,
        action: "auth_login_success",
        entityType: "auth_session",
        data: expect.objectContaining({
          authProvider: "password_mfa",
          mfaSatisfied: true,
          factorId: "factor-1",
          challengeId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        })
      })
    );
  });

  it("does not mint a session for an invalid MFA challenge", async () => {
    mocks.verifyMfaChallenge.mockResolvedValue({
      ok: false,
      code: "invalid_code",
      userId: user.id,
      tenantKey: user.tenant_key,
      workspaceKey: user.workspace_key
    });

    const response = await postChallenge(
      new Request("http://localhost/api/auth/mfa/challenge", {
        method: "POST",
        body: JSON.stringify({ challengeToken: "mfa_token_with_enough_length", code: "000000" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ code: "invalid_code" });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
