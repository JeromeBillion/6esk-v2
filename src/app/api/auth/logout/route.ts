import { recordAuditLog } from "@/server/audit";
import { clearSession, getSessionContext } from "@/server/auth/session";

export async function POST() {
  const context = await getSessionContext();
  await clearSession();
  if (context) {
    await recordAuditLog({
      tenantKey: context.user.tenant_key,
      workspaceKey: context.user.workspace_key,
      actorUserId: context.user.id,
      action: "auth_logout",
      entityType: "auth_session",
      entityId: context.sessionId,
      data: {
        reason: "user_logout"
      }
    }).catch(() => {});
  }
  return Response.json({ status: "ok" });
}
