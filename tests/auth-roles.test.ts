import { describe, expect, it } from "vitest";
import {
  canManageTickets,
  hasTenantAdminAccess,
  isInternalStaff,
  isLeadAdmin,
  isMfaEnrollmentRequiredSession,
  isTenantAdmin
} from "@/server/auth/roles";
import type { SessionUser } from "@/server/auth/session";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

function buildUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "user-1",
    email: "admin@example.test",
    display_name: "Admin",
    role_id: "role-1",
    role_name: "tenant_admin",
    tenant_id: DEFAULT_TENANT_ID,
    tenant_slug: "acme",
    real_tenant_id: DEFAULT_TENANT_ID,
    is_impersonating: false,
    ...overrides
  };
}

describe("auth role capability helpers", () => {
  it("grants role capabilities for MFA-satisfied admin sessions", () => {
    const user = buildUser({ session_auth_provider: "password_mfa" });

    expect(isLeadAdmin(user)).toBe(true);
    expect(isTenantAdmin(user)).toBe(true);
    expect(hasTenantAdminAccess(user)).toBe(true);
    expect(canManageTickets(user)).toBe(true);
  });

  it("denies role capabilities while MFA enrollment is still required", () => {
    const user = buildUser({
      session_auth_provider: "password_mfa_enrollment_required"
    });

    expect(isMfaEnrollmentRequiredSession(user)).toBe(true);
    expect(isLeadAdmin(user)).toBe(false);
    expect(isTenantAdmin(user)).toBe(false);
    expect(hasTenantAdminAccess(user)).toBe(false);
    expect(canManageTickets(user)).toBe(false);
  });

  it("denies internal staff capabilities while MFA enrollment is still required", () => {
    const user = buildUser({
      role_name: "internal_admin",
      session_auth_provider: "google_oauth_mfa_enrollment_required"
    });

    expect(isInternalStaff(user)).toBe(false);
  });

  it("grants internal staff capabilities only from the internal staff tenant", () => {
    const user = buildUser({
      role_name: "internal_admin",
      session_auth_provider: "google_oauth_mfa"
    });

    expect(isInternalStaff(user)).toBe(true);
    expect(hasTenantAdminAccess(user)).toBe(true);
  });

  it("denies tenant-owned internal role names", () => {
    const user = buildUser({
      role_name: "internal_admin",
      tenant_id: "tenant-customer",
      real_tenant_id: "tenant-customer",
      session_auth_provider: "google_oauth_mfa"
    });

    expect(isInternalStaff(user)).toBe(false);
    expect(hasTenantAdminAccess(user)).toBe(false);
  });
});
