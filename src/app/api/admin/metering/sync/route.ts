import { syncPendingMeteringEvents } from "@/server/billing/metering-sync";
import { getSessionUser } from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit";
import { resolveAdminMaintenanceScope } from "@/server/admin-maintenance-scope";
import { runInBackground } from "@/server/async";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const scope = await resolveAdminMaintenanceScope(request, user, {
    sharedSecrets: [
      process.env.JOBS_RUNNER_SECRET,
      process.env.CALLS_OUTBOX_SECRET,
      process.env.WHATSAPP_OUTBOX_SECRET,
      process.env.INBOUND_SHARED_SECRET
    ]
  });
  if (!scope.ok) {
    return scope.response;
  }

  const { searchParams } = new URL(request.url);
  const rawLimit = searchParams.get("limit");
  const limit = Math.min(Math.max(Number(rawLimit) || 100, 1), 500);

  try {
    const result = await syncPendingMeteringEvents({ limit, tenantId: scope.tenantId });

    await recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "metering_sync_triggered",
      entityType: "workspace_module_usage_events",
      data: {
        authMode: scope.authMode,
        limit,
        ...result
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    runInBackground(recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "metering_sync_trigger_failed",
      entityType: "workspace_module_usage_events",
      data: { authMode: scope.authMode, limit, detail: message }
    }), "Failed to record metering sync failure audit event", {
      route: "/api/admin/metering/sync",
      tenantId: scope.tenantId,
      limit
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
