import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { getAgentIntegrationById } from "@/server/agents/integrations";
import { deliverPendingAgentEvents } from "@/server/agents/outbox";
import { recordAuditLog } from "@/server/audit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { agentId } = await params;
  const integration = await getAgentIntegrationById(agentId);
  if (!integration) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), 50)
    : undefined;

  try {
    const result = await deliverPendingAgentEvents({
      integrationId: agentId,
      limit
    });

    await recordAuditLog({
      actorUserId: user?.id ?? null,
      action: "agent_outbox_delivery_triggered",
      entityType: "agent_integration",
      entityId: agentId,
      data: {
        requestedLimit: limit ?? null,
        limitUsed: result.limitUsed,
        delivered: result.delivered,
        skipped: result.skipped
      }
    });

    return Response.json({ status: "ok", ...result });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to deliver agent outbox";
    await recordAuditLog({
      actorUserId: user?.id ?? null,
      action: "agent_outbox_delivery_failed",
      entityType: "agent_integration",
      entityId: agentId,
      data: {
        requestedLimit: limit ?? null,
        detail
      }
    }).catch(() => {});
    return Response.json({ error: "Failed to deliver agent outbox", detail }, { status: 500 });
  }
}
