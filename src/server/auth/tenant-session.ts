import type { SessionUser } from "@/server/auth/session";

export function sessionTenantId(user: Pick<SessionUser, "tenant_id"> | null | undefined) {
  const tenantId = user?.tenant_id?.trim();
  return tenantId || null;
}
