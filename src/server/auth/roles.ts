import type { SessionUser } from "@/server/auth/session";

export const LEAD_ADMIN_ROLE = "lead_admin";

export function isLeadAdmin(user: SessionUser | null) {
  return user?.role_name === LEAD_ADMIN_ROLE;
}
