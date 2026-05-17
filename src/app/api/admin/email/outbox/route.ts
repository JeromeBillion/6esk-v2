import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { deliverPendingEmailOutboxEvents, getEmailOutboxMetrics } from "@/server/email/outbox";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";
import { runInBackground } from "@/server/async";

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const metrics = await getEmailOutboxMetrics(user?.tenant_id ?? null);
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
  const tenantId = user?.tenant_id ?? null;

  try {
    const result = await deliverPendingEmailOutboxEvents({ limit, tenantId });

    await recordAuditLog({
      tenantId: tenantId ?? DEFAULT_TENANT_ID,
      actorUserId: user?.id ?? null,
      action: "email_outbox_triggered",
      entityType: "email_outbox_events",
      data: result
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run email outbox";
    runInBackground(recordAuditLog({
      tenantId: tenantId ?? DEFAULT_TENANT_ID,
      actorUserId: user?.id ?? null,
      action: "email_outbox_trigger_failed",
      entityType: "email_outbox_events",
      data: { limit, detail }
    }), "Failed to record email outbox failure audit event", {
      route: "/api/admin/email/outbox",
      tenantId: tenantId ?? DEFAULT_TENANT_ID,
      limit
    });
    return Response.json({ error: "Failed to run email outbox", detail }, { status: 500 });
  }
}
