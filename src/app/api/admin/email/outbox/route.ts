import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { deliverPendingEmailOutboxEvents, getEmailOutboxMetrics } from "@/server/email/outbox";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const metrics = await getEmailOutboxMetrics();
  return Response.json(metrics);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const sharedSecret = process.env.INBOUND_SHARED_SECRET ?? "";
  const provided = request.headers.get("x-6esk-secret");

  if (!isLeadAdmin(user) && (!sharedSecret || provided !== sharedSecret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 10) || 10, 1), 100);

  try {
    const result = await deliverPendingEmailOutboxEvents({ limit });

    await recordAuditLog({
      tenantId: user?.tenant_id ?? DEFAULT_TENANT_ID,
      actorUserId: user?.id ?? null,
      action: "email_outbox_triggered",
      entityType: "email_outbox_events",
      data: result
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run email outbox";
    await recordAuditLog({
      tenantId: user?.tenant_id ?? DEFAULT_TENANT_ID,
      actorUserId: user?.id ?? null,
      action: "email_outbox_trigger_failed",
      entityType: "email_outbox_events",
      data: { limit, detail }
    }).catch(() => {});
    return Response.json({ error: "Failed to run email outbox", detail }, { status: 500 });
  }
}
