import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { recordAuditLog } from "@/server/audit";
import { resolveAdminMaintenanceScope } from "@/server/admin-maintenance-scope";
import { deliverPendingEmailOutboxEvents, getEmailOutboxMetrics } from "@/server/email/outbox";
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

  const metrics = await getEmailOutboxMetrics(tenantId);
  return Response.json(metrics);
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  const scope = await resolveAdminMaintenanceScope(request, user);
  if (!scope.ok) {
    return scope.response;
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 10) || 10, 1), 100);

  try {
    const result = await deliverPendingEmailOutboxEvents({ limit, tenantId: scope.tenantId });

    await recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "email_outbox_triggered",
      entityType: "email_outbox_events",
      data: {
        authMode: scope.authMode,
        limit,
        ...result
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to run email outbox";
    runInBackground(recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "email_outbox_trigger_failed",
      entityType: "email_outbox_events",
      data: { authMode: scope.authMode, limit, detail }
    }), "Failed to record email outbox failure audit event", {
      route: "/api/admin/email/outbox",
      tenantId: scope.tenantId,
      limit
    });
    return Response.json({ error: "Failed to run email outbox", detail }, { status: 500 });
  }
}
