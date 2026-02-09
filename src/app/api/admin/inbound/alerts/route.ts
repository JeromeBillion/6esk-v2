import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { sendInboundFailureAlert } from "@/server/email/inbound-alerts";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const sharedSecret = process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-6esk-secret");

  if (!isLeadAdmin(user) && (!sharedSecret || provided !== sharedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendInboundFailureAlert();

  await recordAuditLog({
    actorUserId: user?.id ?? null,
    action: "inbound_alert_checked",
    entityType: "inbound_events",
    data: result
  });

  return Response.json({ status: "ok", ...result });
}
