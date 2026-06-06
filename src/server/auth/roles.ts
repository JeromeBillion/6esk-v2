import type { SessionUser } from "@/server/auth/session";

export const LEAD_ADMIN_ROLE = "lead_admin";
export const AGENT_ROLE = "agent";
export const VIEWER_ROLE = "viewer";
export const INTERNAL_SUPPORT_ROLE = "internal_support";
export const SUPPORT_ADMIN_ROLE = "support_admin";
export const BREAK_GLASS_ROLE = "break_glass";
export const FINANCE_ADMIN_ROLE = "finance_admin";

export function isLeadAdmin(user: SessionUser | null) {
  return user?.role_name === LEAD_ADMIN_ROLE;
}

export function isFinanceAdmin(user: SessionUser | null) {
  return user?.role_name === FINANCE_ADMIN_ROLE;
}

export function isViewer(user: SessionUser | null) {
  return user?.role_name === VIEWER_ROLE;
}

export function isInternalSupportUser(user: SessionUser | null) {
  return (
    user?.role_name === INTERNAL_SUPPORT_ROLE ||
    user?.role_name === SUPPORT_ADMIN_ROLE ||
    user?.role_name === BREAK_GLASS_ROLE
  );
}

export function isPrivilegedRole(user: SessionUser | null) {
  return isLeadAdmin(user) || isFinanceAdmin(user) || isInternalSupportUser(user);
}

export function canManageBilling(user: SessionUser | null) {
  return isLeadAdmin(user) || isFinanceAdmin(user);
}

export function canManageTickets(user: SessionUser | null) {
  return Boolean(user && user.role_name && user.role_name !== VIEWER_ROLE);
}
