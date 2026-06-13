import { getSessionUser } from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit";
import { sendInboundFailureAlert } from "@/server/email/inbound-alerts";
import { resolveInboundAdminScope } from "@/server/email/inbound-admin-scope";

async function safeRecordAuditLog(data: {
  tenantId: string;
  actorUserId: string | null;
  action: string;
  payload: Record<string, unknown>;
}) {
  try {
    await recordAuditLog({
      tenantId: data.tenantId,
      actorUserId: data.actorUserId,
      action: data.action,
      entityType: "inbound_events",
      data: data.payload
    });
  } catch (error) {
    // Audit logging should never block alert checks.
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const scope = await resolveInboundAdminScope(request, user);
  if (!scope.ok) {
    return scope.response;
  }

  try {
    const result = await sendInboundFailureAlert({ tenantId: scope.tenantId });

    await safeRecordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "inbound_alert_checked",
      payload: { authMode: scope.authMode, ...(result as Record<string, unknown>) }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    await safeRecordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "inbound_alert_check_failed",
      payload: { authMode: scope.authMode, error: detail }
    });
    return Response.json(
      {
        error: "Failed to run inbound alert check",
        detail
      },
      { status: 500 }
    );
  }
}
