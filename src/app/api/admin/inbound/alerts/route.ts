import { requireLeadAdminOrMachineAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { sendInboundFailureAlert } from "@/server/email/inbound-alerts";
import { type TenantScope } from "@/server/tenant-context";

async function safeRecordAuditLog(data: {
  scope: TenantScope;
  actorUserId: string | null;
  action: string;
  payload: Record<string, unknown>;
}) {
  try {
    await recordAuditLog({
      tenantKey: data.scope.tenantKey,
      workspaceKey: data.scope.workspaceKey,
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
  const access = await requireLeadAdminOrMachineAccess(request, {
    secretEnvNames: ["INBOUND_SHARED_SECRET"]
  });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  try {
    const result = await sendInboundFailureAlert(scope);

    await safeRecordAuditLog({
      scope,
      actorUserId: user?.id ?? null,
      action: "inbound_alert_checked",
      payload: result as Record<string, unknown>
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    await safeRecordAuditLog({
      scope,
      actorUserId: user?.id ?? null,
      action: "inbound_alert_check_failed",
      payload: { error: detail }
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
