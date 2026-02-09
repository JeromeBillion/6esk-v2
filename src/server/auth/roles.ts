import type { SessionUser } from "@/server/auth/session";

export const LEAD_ADMIN_ROLE = "lead_admin";
export const AGENT_ROLE = "agent";
export const VIEWER_ROLE = "viewer";

export function isLeadAdmin(user: SessionUser | null) {
  return user?.role_name === LEAD_ADMIN_ROLE;
}

export function isViewer(user: SessionUser | null) {
  return user?.role_name === VIEWER_ROLE;
}

export function canManageTickets(user: SessionUser | null) {
  return Boolean(user && user.role_name && user.role_name !== VIEWER_ROLE);
}
