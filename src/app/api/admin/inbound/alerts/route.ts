import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { sendInboundFailureAlert } from "@/server/email/inbound-alerts";

import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

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
  const sharedSecret = process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-6esk-secret");

  if (!isLeadAdmin(user) && (!sharedSecret || provided !== sharedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendInboundFailureAlert();

    await safeRecordAuditLog({
      tenantId: user?.tenant_id ?? DEFAULT_TENANT_ID,
      actorUserId: user?.id ?? null,
      action: "inbound_alert_checked",
      payload: result as Record<string, unknown>
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error";
    await safeRecordAuditLog({
      tenantId: user?.tenant_id ?? DEFAULT_TENANT_ID,
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
