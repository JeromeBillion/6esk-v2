import { getSessionUser } from "@/server/auth/session";
import { deliverPendingAgentEvents } from "@/server/agents/outbox";
import { recordAuditLog } from "@/server/audit";
import { resolveAdminMaintenanceScope } from "@/server/admin-maintenance-scope";
import { runInBackground } from "@/server/async";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const scope = await resolveAdminMaintenanceScope(request, user, {
    sharedSecrets: [
      process.env.JOBS_RUNNER_SECRET,
      process.env.INBOUND_SHARED_SECRET,
      process.env.SIXESK_SHARED_SECRET
    ]
  });
  if (!scope.ok) {
    return scope.response;
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 5) || 5, 1), 50);

  try {
    const result = await deliverPendingAgentEvents({ tenantId: scope.tenantId, limit });

    await recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "agent_outbox_delivery_triggered",
      entityType: "agent_outbox",
      data: {
        authMode: scope.authMode,
        limit,
        ...result
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to deliver agent outbox";
    runInBackground(recordAuditLog({
      tenantId: scope.tenantId,
      actorUserId: scope.actorUserId,
      action: "agent_outbox_delivery_failed",
      entityType: "agent_outbox",
      data: { authMode: scope.authMode, limit, detail }
    }), "Failed to record agent outbox delivery failure audit event", {
      route: "/api/agent/v1/outbox/deliver",
      tenantId: scope.tenantId,
      limit
    });
    return Response.json({ error: "Failed to deliver agent outbox", detail }, { status: 500 });
  }
}
