import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isMfaRequiredForLogin: vi.fn()
}));

vi.mock("@/server/auth/mfa", () => ({
  isMfaRequiredForLogin: mocks.isMfaRequiredForLogin
}));

import {
  assertSensitiveSessionMfa,
  isMfaEnrollmentRequiredAuthProvider,
  isMfaSatisfiedAuthProvider,
  SensitiveSessionAuthorizationError
} from "@/server/auth/sensitive-session";

function user(roleName: string) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: `${roleName}@example.test`,
    display_name: roleName,
    role_id: null,
    role_name: roleName,
    tenant_key: "tenant-a",
    workspace_key: "workspace-a"
  };
}

describe("sensitive session MFA guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMfaRequiredForLogin.mockResolvedValue(true);
  });

  it("recognizes only MFA-completed auth providers as satisfied", () => {
    expect(isMfaSatisfiedAuthProvider("password_mfa")).toBe(true);
    expect(isMfaSatisfiedAuthProvider("better_auth_mfa")).toBe(true);
    expect(isMfaSatisfiedAuthProvider("password")).toBe(false);
    expect(isMfaEnrollmentRequiredAuthProvider("password_mfa_enrollment_required")).toBe(true);
  });

  it("allows non-privileged roles without consulting MFA policy", async () => {
    await expect(
      assertSensitiveSessionMfa({ user: user("agent"), authProvider: "password" })
    ).resolves.toBeUndefined();
    expect(mocks.isMfaRequiredForLogin).not.toHaveBeenCalled();
  });

  it("blocks privileged roles with enrollment-required sessions", async () => {
    await expect(
      assertSensitiveSessionMfa({
        user: user("internal_support"),
        authProvider: "password_mfa_enrollment_required"
      })
    ).rejects.toMatchObject({
      code: "mfa_enrollment_required"
    } satisfies Partial<SensitiveSessionAuthorizationError>);
  });

  it("allows privileged roles with MFA-completed sessions", async () => {
    await expect(
      assertSensitiveSessionMfa({ user: user("support_admin"), authProvider: "password_mfa" })
    ).resolves.toBeUndefined();
  });
});
