import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { recordAuditLog } from "@/server/audit";
import { resolveAdminMaintenanceScope } from "@/server/admin-maintenance-scope";
import { deliverPendingCallEvents, getCallOutboxMetrics } from "@/server/calls/outbox";
import { getCallWebhookSecurityConfig } from "@/server/calls/webhook";
import { runInBackground } from "@/server/async";

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const metrics = await getCallOutboxMetrics(tenantId);
  return Response.json({
    ...metrics,
    webhookSecurity: getCallWebhookSecurityConfig()
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const scope = await resolveAdminMaintenanceScope(request, user, {
    sharedSecrets: [process.env.CALLS_OUTBOX_SECRET, process.env.INBOUND_SHARED_SECRET]
  });
  if (!scope.ok) {
    return scope.response;
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 10) || 10, 1), 100);

  try {
    const result = await deliverPendingCallEvents({ limit, tenantId: scope.tenantId });

    await recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "call_outbox_triggered",
      entityType: "call_outbox_events",
      data: {
        authMode: scope.authMode,
        limit,
        ...result
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run call outbox";
    runInBackground(recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "call_outbox_trigger_failed",
      entityType: "call_outbox_events",
      data: {
        authMode: scope.authMode,
        limit,
        detail
      }
    }), "Failed to record call outbox failure audit event", {
      route: "/api/admin/calls/outbox",
      tenantId: scope.tenantId,
      limit
    });
    return Response.json({ error: "Failed to run call outbox", detail }, { status: 500 });
  }
}
