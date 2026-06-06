import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  createSession: vi.fn(),
  verifyMfaChallenge: vi.fn(),
  getMfaStatusForUser: vi.fn(),
  startTotpEnrollment: vi.fn(),
  verifyTotpEnrollment: vi.fn(),
  recordAuditLog: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser,
  createSession: mocks.createSession
}));

vi.mock("@/server/auth/mfa", () => ({
  verifyMfaChallenge: mocks.verifyMfaChallenge,
  getMfaStatusForUser: mocks.getMfaStatusForUser,
  startTotpEnrollment: mocks.startTotpEnrollment,
  verifyTotpEnrollment: mocks.verifyTotpEnrollment
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

import { POST as POST_CHALLENGE } from "@/app/api/auth/mfa/challenge/route";
import { GET as GET_ENROLL, POST as POST_ENROLL } from "@/app/api/auth/mfa/enroll/route";
import { POST as POST_VERIFY_ENROLLMENT } from "@/app/api/auth/mfa/enroll/verify/route";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const user = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  email: "admin@example.test",
  display_name: "Admin",
  role_id: "role-1",
  role_name: "tenant_admin",
  tenant_id: TENANT_ID,
  tenant_slug: "acme",
  real_tenant_id: TENANT_ID,
  is_impersonating: false
};

describe("MFA API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.createSession.mockResolvedValue(undefined);
  });

  it("verifies an MFA challenge and mints an MFA-authenticated session", async () => {
    mocks.verifyMfaChallenge.mockResolvedValue({
      ok: true,
      userId: user.id,
      tenantId: TENANT_ID,
      workspaceKey: "primary",
      factorId: "factor-1",
      challengeId: "challenge-1"
    });

    const response = await POST_CHALLENGE(
      new Request("http://localhost/api/auth/mfa/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeToken: "mfa_token", code: "123456" })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(mocks.createSession).toHaveBeenCalledWith(user.id, {
      authProvider: "password_mfa",
      requestHeaders: expect.any(Headers)
    });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: user.id,
        action: "auth_mfa_challenge_verified"
      })
    );
  });

  it("returns MFA enrollment status for the current session user", async () => {
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.getMfaStatusForUser.mockResolvedValue({ required: true, factors: [] });

    const response = await GET_ENROLL();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: { required: true, factors: [] } });
    expect(mocks.getMfaStatusForUser).toHaveBeenCalledWith(user);
  });

  it("starts TOTP enrollment for the current session user", async () => {
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.startTotpEnrollment.mockResolvedValue({
      enrollmentToken: "enroll-token",
      otpauthUrl: "otpauth://totp/6esk",
      secretBase32: "JBSWY3DPEHPK3PXP",
      expiresAt: new Date("2026-06-06T10:10:00.000Z")
    });

    const response = await POST_ENROLL(
      new Request("http://localhost/api/auth/mfa/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: "Admin phone" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      enrollmentToken: "enroll-token",
      secretBase32: "JBSWY3DPEHPK3PXP"
    });
    expect(mocks.startTotpEnrollment).toHaveBeenCalledWith({
      user,
      label: "Admin phone"
    });
  });

  it("verifies TOTP enrollment and audits the factor", async () => {
    mocks.getSessionUser.mockResolvedValue(user);
    mocks.verifyTotpEnrollment.mockResolvedValue({
      ok: true,
      factorId: "factor-1"
    });

    const response = await POST_VERIFY_ENROLLMENT(
      new Request("http://localhost/api/auth/mfa/enroll/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enrollmentToken: "enroll-token", code: "123456" })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", factorId: "factor-1" });
    expect(mocks.recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        actorUserId: user.id,
        action: "auth_mfa_enrollment_verified"
      })
    );
  });
});
