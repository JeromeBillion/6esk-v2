import type { SessionUser } from "@/server/auth/session";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

// ---------------------------------------------------------------------------
// v1 role names (preserved for backward compatibility)
// ---------------------------------------------------------------------------
export const LEAD_ADMIN_ROLE = "lead_admin";
export const AGENT_ROLE = "agent";
export const VIEWER_ROLE = "viewer";

// ---------------------------------------------------------------------------
// v2 role names (tenant-scoped)
// ---------------------------------------------------------------------------
export const TENANT_ADMIN_ROLE = "tenant_admin";
export const TENANT_OPERATOR_ROLE = "tenant_operator";

// Internal 6esk staff roles (cross-tenant)
export const INTERNAL_ADMIN_ROLE = "internal_admin";
export const INTERNAL_SUPPORT_ROLE = "internal_support";
export const INTERNAL_STAFF_TENANT_ID_ENV = "INTERNAL_STAFF_TENANT_ID";

// ---------------------------------------------------------------------------
// Role checks
// ---------------------------------------------------------------------------

const MFA_ENROLLMENT_REQUIRED_SUFFIX = "_mfa_enrollment_required";

export function isMfaEnrollmentRequiredSession(user: Pick<SessionUser, "session_auth_provider"> | null) {
  const provider = user?.session_auth_provider?.trim().toLowerCase() ?? "";
  return provider.endsWith(MFA_ENROLLMENT_REQUIRED_SUFFIX);
}

type RoleUser = Pick<
  SessionUser,
  "role_name" | "session_auth_provider" | "tenant_id" | "real_tenant_id"
> | null;

export function internalStaffTenantId() {
  return process.env[INTERNAL_STAFF_TENANT_ID_ENV]?.trim() || DEFAULT_TENANT_ID;
}

function hasUsableRole(user: RoleUser): user is NonNullable<RoleUser> & { role_name: string } {
  return Boolean(user?.role_name) && !isMfaEnrollmentRequiredSession(user);
}

function hasInternalStaffTenant(user: RoleUser) {
  const tenantId = user?.real_tenant_id || user?.tenant_id;
  return Boolean(tenantId && tenantId === internalStaffTenantId());
}

function isInternalRoleName(roleName: string | null | undefined) {
  return roleName === INTERNAL_ADMIN_ROLE || roleName === INTERNAL_SUPPORT_ROLE;
}

export function isLeadAdmin(user: SessionUser | null) {
  return hasUsableRole(user) && (user?.role_name === LEAD_ADMIN_ROLE || user?.role_name === TENANT_ADMIN_ROLE);
}

export function isTenantAdmin(user: SessionUser | null) {
  return hasUsableRole(user) && (user?.role_name === TENANT_ADMIN_ROLE || user?.role_name === LEAD_ADMIN_ROLE);
}

export function isInternalStaff(user: SessionUser | null) {
  return hasUsableRole(user) && isInternalRoleName(user.role_name) && hasInternalStaffTenant(user);
}

export function isInternalAdminStaff(user: SessionUser | null) {
  return hasUsableRole(user) && user.role_name === INTERNAL_ADMIN_ROLE && hasInternalStaffTenant(user);
}

export function isViewer(user: SessionUser | null) {
  return user?.role_name === VIEWER_ROLE;
}

export function canManageTickets(user: SessionUser | null) {
  return hasUsableRole(user) && user?.role_name !== VIEWER_ROLE;
}

/**
 * Check if a user has administrative privileges within their tenant.
 * Internal staff also qualifies.
 */
export function hasTenantAdminAccess(user: SessionUser | null) {
  if (!hasUsableRole(user)) return false;
  return (
    user.role_name === LEAD_ADMIN_ROLE ||
    user.role_name === TENANT_ADMIN_ROLE ||
    isInternalAdminStaff(user)
  );
}
