import type { SessionUser } from "@/server/auth/session";

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

// ---------------------------------------------------------------------------
// Role checks
// ---------------------------------------------------------------------------

const MFA_ENROLLMENT_REQUIRED_SUFFIX = "_mfa_enrollment_required";

export function isMfaEnrollmentRequiredSession(user: Pick<SessionUser, "session_auth_provider"> | null) {
  const provider = user?.session_auth_provider?.trim().toLowerCase() ?? "";
  return provider.endsWith(MFA_ENROLLMENT_REQUIRED_SUFFIX);
}

function hasUsableRole(user: SessionUser | null): user is SessionUser & { role_name: string } {
  return Boolean(user?.role_name) && !isMfaEnrollmentRequiredSession(user);
}

export function isLeadAdmin(user: SessionUser | null) {
  return hasUsableRole(user) && (user?.role_name === LEAD_ADMIN_ROLE || user?.role_name === TENANT_ADMIN_ROLE);
}

export function isTenantAdmin(user: SessionUser | null) {
  return hasUsableRole(user) && (user?.role_name === TENANT_ADMIN_ROLE || user?.role_name === LEAD_ADMIN_ROLE);
}

export function isInternalStaff(user: SessionUser | null) {
  return hasUsableRole(user) && (user?.role_name === INTERNAL_ADMIN_ROLE || user?.role_name === INTERNAL_SUPPORT_ROLE);
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
    user.role_name === INTERNAL_ADMIN_ROLE
  );
}
